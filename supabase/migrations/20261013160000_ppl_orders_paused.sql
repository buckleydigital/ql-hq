-- Pause switch for pay-per-lead orders. While true, create-ppl-checkout (lead
-- pack reorders from the dashboard) and create-ppl-signup-checkout (new PPL
-- signups from quoteleads.com.au) refuse to start a checkout. Nothing else
-- about PPL changes: orders, leads, delivery and pricing stay as they are.
-- The website and dashboard each have their own PPL_PAUSED flag for the
-- page itself.
alter table public.platform_settings
  add column if not exists ppl_orders_paused boolean not null default false;

update public.platform_settings set ppl_orders_paused = true where id = 1;
