-- ════════════════════════════════════════════════════════════════════════════
-- Two corrections found by applying the previous migrations to production
--
-- 1. THREE COLUMNS THE NEW CODE NEEDS DO NOT EXIST
--    20260522000007_onboarding_fulfillment.sql is in the repo but was never
--    applied to this database, so `companies` has no onboarding_completed,
--    max_daily_ad_spend or generated_ad_copy. growth-onboarding writes the first
--    two and fulfilment-ai writes the third, so all three would have thrown at
--    runtime. Only the columns actually used are added here - the rest of that
--    abandoned migration (lead_goals, onboarding_images, generated_page_url,
--    generated_page_repo, meta_ad_account_id, google_ads_customer_id) is left
--    alone rather than resurrected on a guess about whether it is still wanted.
--
-- 2. THE BACKFILL HAD NOTHING TO WORK WITH, SO EVERY CLIENT READ AS OVERDUE
--    The previous backfill inferred "past onboarding" from companies.ads_live_date.
--    That column is populated for exactly zero companies here, so the inference
--    matched nothing and all 26 clients came out pending from step three onwards -
--    the wall of false alarms the backfill existed to prevent.
--
--    The evidence that does exist is delivered leads. A company with leads has
--    demonstrably been through onboarding: you cannot receive leads without the
--    ad account access, the assets, an approved campaign and live ads. Same for a
--    PPL order that was fulfilled.
--
--    So: leads or orders settle the onboarding chain, and because leads existing
--    is direct evidence rather than inference, `first_lead` is recorded as 'done'
--    while the steps leading to it stay 'skipped' - we know they happened, we did
--    not watch them happen. A company with no leads and no orders is left alone:
--    those are either genuinely mid-onboarding or dormant test accounts, and both
--    are things a person should look at rather than have the migration decide.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. The missing columns ─────────────────────────────────────────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_daily_ad_spend   numeric(10,2),
  ADD COLUMN IF NOT EXISTS generated_ad_copy    jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.companies.generated_ad_copy IS
  'The ad copy fulfilment-ai generated, with the model and timestamp. Regenerated rather than hand-edited; the version sent to the client is the one in the preview email.';
COMMENT ON COLUMN public.companies.max_daily_ad_spend IS
  'From the growth onboarding form. Used as context when generating ad copy.';

-- ─── 2. Backfill from evidence that exists ──────────────────────────────────
-- Leads or a PPL order mean this client is past onboarding. 'skipped' because we
-- are inferring the individual steps, not attesting to them - and it reads
-- differently in the panel from a step someone actually ticked.
WITH live AS (
  SELECT c.id,
         GREATEST(
           coalesce((SELECT max(l.created_at) FROM public.leads l WHERE l.company_id = c.id), c.created_at),
           c.created_at
         ) AS evidence_at
    FROM public.companies c
   WHERE EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id = c.id)
      OR EXISTS (SELECT 1 FROM public.ppl_orders o WHERE o.company_id = c.id)
)
INSERT INTO public.company_fulfilment (company_id, step_key, status, completed_at, completed_by_name, notes)
SELECT live.id, d.step_key, 'skipped', live.evidence_at, 'migrated',
       'Pre-dates fulfilment tracking; inferred from leads already being delivered'
  FROM live
  CROSS JOIN public.fulfilment_step_defs d
 WHERE d.phase = 'onboarding'
   AND d.sort_order <= (SELECT sort_order FROM public.fulfilment_step_defs WHERE step_key = 'ads_live')
ON CONFLICT (company_id, step_key) DO NOTHING;

-- first_lead is not inference: the leads are in the table. Recorded as 'done'.
INSERT INTO public.company_fulfilment (company_id, step_key, status, completed_at, completed_by_name, notes)
SELECT c.id, 'first_lead', 'done',
       (SELECT min(l.created_at) FROM public.leads l WHERE l.company_id = c.id),
       'migrated', 'Backfilled from the first lead on the account'
  FROM public.companies c
 WHERE EXISTS (SELECT 1 FROM public.leads l WHERE l.company_id = c.id)
ON CONFLICT (company_id, step_key) DO NOTHING;

-- ─── 3. Recompute ───────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.companies LOOP
    PERFORM public.recalc_company_fulfilment(r.id);
  END LOOP;
END $$;
