-- Instant leads: Meta pushes each lead from a client's Page to meta-leads.
-- meta_leads (made for campaign-build, never used) now holds what arrives:
-- every lead is recorded once, and only clients switched to "direct"
-- (companies.campaign_settings.lead_delivery) have it delivered from here.
-- Everyone else's still comes through Make.
alter table public.meta_leads add column if not exists page_id text;
alter table public.meta_leads add column if not exists delivery text not null default 'make'
  check (delivery in ('make', 'direct'));
create index if not exists meta_leads_company on public.meta_leads (company_id, created_at desc);

-- Every 30 minutes: sign built clients' Pages up to the app's leadgen webhook,
-- and retry any direct delivery that failed.
select cron.schedule(
  'meta-leads-subscribe',
  '*/30 * * * *',
  $$ select net.http_post(
       url     := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/meta-leads',
       headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'x-autopilot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_secret')),
       body    := '{"action":"subscribe"}'::jsonb,
       timeout_milliseconds := 120000) $$
);
