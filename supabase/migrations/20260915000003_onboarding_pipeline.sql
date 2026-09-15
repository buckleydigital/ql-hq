-- ════════════════════════════════════════════════════════════════════════════
-- The fulfilment pipeline: capture → verify → account → copy → creatives → preview
--
-- THE FLOW THIS ENCODES
--   1. Capture      growth-onboarding.html posts the form here.
--   2. Verify       Spam gate. The email or phone must already exist in a
--                   ql-mc sales pipeline stage, i.e. we actually spoke to them.
--                   Match → straight through. No match → HELD for review, and
--                   no account is created until a human approves it.
--   3. Account      Created automatically, then the welcome email goes out.
--   4. Ad copy      Generated with Claude.
--   5. Creatives    Generated with htmlcsstoimage, or made by hand in Canva.
--   6. Previews     The team attaches links/images and presses send. Templated
--                   email, confirm-then-send, never automatic.
--
--   The manual work between those steps - confirming Meta/Google access,
--   confirming a custom CRM integration - is not separate from this. It is the
--   same checklist (20260915000001), so one list shows the team what the
--   software has done and what is still theirs to do, and the automated steps
--   tick themselves off as they run.
--
-- WHY THE GATE DEFAULTS TO HOLDING
--   Creating an account is the irreversible-ish step: it provisions a login,
--   sends a real email to a real address, and pushes a client into fulfilment.
--   A spam signup that sails through costs more than a genuine signup that
--   waits twenty minutes for someone to press Approve. So "no match" holds
--   rather than rejects, and nothing about the hold is destructive.
--
-- LOCKED AWAY FROM CLIENTS, same three ways as 20260915000001: RLS forced with
-- no policy, privileges revoked from anon and authenticated, and nothing added
-- to a client-facing table. Submissions contain other people's contact details
-- and internal review notes; they are for the Internal Team only, through
-- team-api under the service role.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. What the form captured, and what we decided about it ────────────────
CREATE TABLE IF NOT EXISTS public.onboarding_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The whole posted form, kept verbatim. The named columns below are for
  -- querying and for the review queue; this is so a field added to the form
  -- tomorrow is not silently lost today.
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,

  first_name    text,
  last_name     text,
  email         text,
  phone         text,
  -- Normalised at write time, because the gate matches on it and
  -- "0412 345 678" must find "+61412345678".
  phone_e164    text,
  company       text,
  industry      text,
  service_location text,
  service_radius   text,
  max_daily_spend  text,

  -- ── The spam gate ──
  --   pending   not yet checked (ql-mc unreachable, will be retried)
  --   matched   found in a ql-mc pipeline stage, cleared automatically
  --   held      no match, waiting on a human
  --   approved  a human released it
  --   rejected  a human binned it
  gate_status   text NOT NULL DEFAULT 'pending'
                  CHECK (gate_status IN ('pending','matched','held','approved','rejected')),
  gate_checked_at timestamptz,
  -- What matched and where, or why we could not tell. Shown in the review queue
  -- so the decision is not "computer says no".
  gate_detail   jsonb NOT NULL DEFAULT '{}'::jsonb,

  reviewed_by   uuid,
  reviewed_by_name text,
  reviewed_at   timestamptz,
  review_notes  text,

  -- ── What the automation did ──
  company_id    uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  account_created_at    timestamptz,
  welcome_email_sent_at timestamptz,
  -- Set when a step fails, so a stuck submission is visible rather than silent.
  last_error    text,
  error_at      timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS onboarding_submissions_gate_idx
  ON public.onboarding_submissions (gate_status, created_at DESC);
CREATE INDEX IF NOT EXISTS onboarding_submissions_email_idx
  ON public.onboarding_submissions (lower(email));
CREATE INDEX IF NOT EXISTS onboarding_submissions_phone_idx
  ON public.onboarding_submissions (phone_e164);
CREATE INDEX IF NOT EXISTS onboarding_submissions_company_idx
  ON public.onboarding_submissions (company_id);

COMMENT ON TABLE public.onboarding_submissions IS
  'Every growth-onboarding submission, its spam-gate verdict and what the automation did with it. Internal only.';
COMMENT ON COLUMN public.onboarding_submissions.gate_status IS
  'held = no match in ql-mc, no account created, waiting on a human. The gate holds rather than rejects on purpose.';
COMMENT ON COLUMN public.onboarding_submissions.payload IS
  'The form exactly as posted, so a field added to the form is captured before anyone remembers to add a column.';

-- Same idempotency guard the rest of the system uses: a double-submitted form
-- (impatient click, keepalive retry) must not become two accounts. A resubmit
-- from the same email inside the window updates the open row instead.
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_submissions_open_email_uniq
  ON public.onboarding_submissions (lower(email))
  WHERE gate_status IN ('pending','held','matched','approved') AND company_id IS NULL;

CREATE OR REPLACE FUNCTION public.onboarding_submissions_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS onboarding_submissions_touch_trg ON public.onboarding_submissions;
CREATE TRIGGER onboarding_submissions_touch_trg
  BEFORE UPDATE ON public.onboarding_submissions
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_submissions_touch();

-- ─── 2. Which steps the software does itself ────────────────────────────────
-- The checklist already exists. This adds the flag that lets the panel show a
-- "Run it" button on the steps the software can do, and nothing on the ones only
-- a person can. Without it the page would have to hard-code which is which, and
-- the catalogue would stop being the single description of the flow.
ALTER TABLE public.fulfilment_step_defs
  ADD COLUMN IF NOT EXISTS automation text;

COMMENT ON COLUMN public.fulfilment_step_defs.automation IS
  'Names the automation that can complete this step (ad_copy, creatives, preview_email, …). NULL = only a person can tick it.';

-- ─── 3. The steps the new flow introduces ───────────────────────────────────
-- Slotted between the existing ones rather than appended, so the checklist reads
-- in the order the work actually happens. sort_order leaves gaps for the same
-- reason it did the first time.
INSERT INTO public.fulfilment_step_defs
  (step_key, label, phase, sort_order, owner_role, required, sla_hours, mc_sub_stage, mc_active_status, automation) VALUES
  ('signup_verified',    'Signup verified (spam gate)',    'onboarding', 32, 'ops',    true,  4,    'Form Filled',                        NULL, 'spam_gate'),
  ('account_created',    'QuoteLeadsHQ account created',   'onboarding', 34, 'team',   true,  1,    'Form Filled',                        NULL, 'account'),
  ('welcome_email_sent', 'Welcome email sent',             'onboarding', 36, 'team',   true,  1,    'Form Filled',                        NULL, 'welcome_email'),
  ('crm_integration',    'Custom CRM integration confirmed','onboarding',45, 'team',   false, 72,   'Meta/Google Access Granted',         NULL, NULL),
  ('ad_copy_generated',  'Ad copy generated',              'onboarding', 52, 'team',   true,  24,   'Assets Provided & Previews Pending', NULL, 'ad_copy'),
  ('creatives_generated','Creatives generated',            'onboarding', 54, 'team',   true,  24,   'Assets Provided & Previews Pending', NULL, 'creatives')
ON CONFLICT (step_key) DO UPDATE
  SET label            = EXCLUDED.label,
      phase            = EXCLUDED.phase,
      sort_order       = EXCLUDED.sort_order,
      owner_role       = EXCLUDED.owner_role,
      required         = EXCLUDED.required,
      sla_hours        = EXCLUDED.sla_hours,
      mc_sub_stage     = EXCLUDED.mc_sub_stage,
      mc_active_status = EXCLUDED.mc_active_status,
      automation       = EXCLUDED.automation;

-- previews_sent is now a confirm-then-send button rather than something someone
-- does in their own mail client, so it gains an automation too.
UPDATE public.fulfilment_step_defs SET automation = 'preview_email' WHERE step_key = 'previews_sent';
UPDATE public.fulfilment_step_defs SET automation = 'intro_email'   WHERE step_key = 'intro_email_sent';

-- Existing clients were counted against a 10-step denominator. Six new required
-- steps would make every one of them look like it had gone backwards, so the
-- steps they are demonstrably past are settled the same way 20260915000001 did
-- it: 'skipped', inference not attestation, with the reason on the row.
INSERT INTO public.company_fulfilment (company_id, step_key, status, completed_at, completed_by_name, notes)
SELECT c.id, d.step_key, 'skipped', coalesce(c.ads_live_date::timestamptz, c.created_at), 'migrated',
       'Pre-dates the automated pipeline; inferred from ads being live'
  FROM public.companies c
  CROSS JOIN public.fulfilment_step_defs d
 WHERE c.ads_live_date IS NOT NULL
   AND d.step_key IN ('signup_verified','account_created','welcome_email_sent','ad_copy_generated','creatives_generated')
ON CONFLICT (company_id, step_key) DO NOTHING;

-- An existing client obviously has an account, whether or not ads are live yet.
INSERT INTO public.company_fulfilment (company_id, step_key, status, completed_at, completed_by_name, notes)
SELECT c.id, 'account_created', 'done', c.created_at, 'migrated',
       'Backfilled from the company record'
  FROM public.companies c
ON CONFLICT (company_id, step_key) DO NOTHING;

-- ─── 4. Hard lock ───────────────────────────────────────────────────────────
-- See the header, and 20260915000001 section 8 for why the REVOKEs matter as
-- much as the RLS: Supabase grants anon/authenticated table privileges on public
-- by default, so revoking is what stops a policy added later from opening this
-- up on its own.
ALTER TABLE public.onboarding_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_submissions FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.onboarding_submissions FROM PUBLIC;
REVOKE ALL ON TABLE public.onboarding_submissions FROM anon;
REVOKE ALL ON TABLE public.onboarding_submissions FROM authenticated;
GRANT ALL ON TABLE public.onboarding_submissions TO service_role;

REVOKE ALL ON FUNCTION public.onboarding_submissions_touch() FROM PUBLIC, anon, authenticated;

-- Recompute every summary: six new required steps changed the denominator, so
-- the mirror ql-mc reads would otherwise be stale until each client next moved.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.companies LOOP
    PERFORM public.recalc_company_fulfilment(r.id);
  END LOOP;
END $$;
