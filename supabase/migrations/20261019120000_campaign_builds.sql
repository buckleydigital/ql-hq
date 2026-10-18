-- Phase 4: the approved ads become a paused campaign in the client's ad account,
-- with our own instant form, and that form's leads come straight into the CRM.
--
-- companies.campaign_settings  the team's choices for this client, which win
--   over what onboarding told us: { daily_budget, locations: [{ key, name,
--   type, radius_km }], age_min, privacy_url }
-- campaign_builds  one per build, a step at a time so a retry resumes rather
--   than building twice: what was decided (settings), what exists in Meta
--   (meta: form, campaign, ad set, ads) and how far it got (stage)
-- meta_leads  every lead read from one of our forms, so none is delivered twice

alter table public.companies add column if not exists campaign_settings jsonb not null default '{}'::jsonb;

create table if not exists public.campaign_builds (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  round_id      uuid references public.creative_rounds(id) on delete set null,
  status        text not null default 'queued'
                check (status in ('queued', 'building', 'built', 'needs_team', 'failed', 'replaced')),
  stage         text not null default 'settings',
  settings      jsonb not null default '{}'::jsonb,
  meta          jsonb not null default '{}'::jsonb,
  error         text,
  attempts      int not null default 0,
  started_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  built_at      timestamptz
);
-- One live build per client: a rebuild replaces the last one first.
create unique index if not exists campaign_builds_one_live
  on public.campaign_builds (company_id) where status in ('queued', 'building', 'built', 'needs_team');
create index if not exists campaign_builds_status on public.campaign_builds (status);
alter table public.campaign_builds enable row level security;

create table if not exists public.meta_leads (
  leadgen_id   text primary key,
  company_id   uuid not null references public.companies(id) on delete cascade,
  build_id     uuid references public.campaign_builds(id) on delete set null,
  form_id      text not null,
  ad_id        text,
  fields       jsonb not null default '{}'::jsonb,
  lead_id      uuid,
  error        text,
  attempts     int not null default 0,
  meta_created_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists meta_leads_undelivered on public.meta_leads (created_at) where lead_id is null;
alter table public.meta_leads enable row level security;

-- Every 5 minutes: build what's due, and bring in new leads from our forms.
select cron.schedule(
  'campaign-autopilot',
  '*/5 * * * *',
  $$ select net.http_post(
       url     := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/campaign-build',
       headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'x-autopilot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_secret')),
       body    := '{"action":"autopilot"}'::jsonb,
       timeout_milliseconds := 150000) $$
);
