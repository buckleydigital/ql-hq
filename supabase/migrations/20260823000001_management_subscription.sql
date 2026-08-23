-- ============================================================================
-- Ongoing management subscription ($600/mo)
-- ============================================================================
-- The Branded Lead Gen System is a one-off build that includes the first 30
-- days of management. After that the client decides whether we keep running
-- the campaigns. Until now that decision had no billing rail behind it - the
-- $600/mo was advertised but every Stripe checkout in the platform was
-- mode:'payment', so management was invoiced by hand or not at all.
--
-- These columns track the Stripe subscription that covers it. The billing
-- state itself lives in Stripe; what we keep here is enough to render the
-- dashboard and answer "is this company paying for management right now"
-- without a round trip to the Stripe API on every page load.
--
-- managed_from is the anchor for the included 30 days. It defaults to
-- ads_live_date (added in the invoicing migration) because the included
-- period starts when their ads go live, not when they paid.
-- ============================================================================

alter table public.companies
  -- active | trialing | past_due | canceled | incomplete | null (never started)
  add column if not exists management_status          text,
  add column if not exists management_subscription_id text,
  -- End of the current paid period, straight from Stripe. Also the date a
  -- cancelled subscription actually stops, since we cancel at period end.
  add column if not exists management_period_end      timestamptz,
  add column if not exists management_cancel_at_end   boolean not null default false,
  -- Start of the included 30 days. Set when their ads go live.
  add column if not exists management_included_from   date;

-- One Stripe subscription per company. Partial so the many nulls do not collide.
create unique index if not exists companies_management_subscription_id_idx
  on public.companies (management_subscription_id)
  where management_subscription_id is not null;

-- Backfill the included-period anchor for companies already running ads.
update public.companies
   set management_included_from = ads_live_date
 where management_included_from is null
   and ads_live_date is not null;
