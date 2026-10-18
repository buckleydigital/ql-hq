-- Phase 1: notice when a client gives us Meta access, and chase them if not.
--
-- meta-access-watch runs every 15 minutes. It ticks "Meta/Google access
-- granted" when a client's ad account shows up in our Business Manager,
-- connects our system user to it, and emails reminders on day 2 and day 4
-- after payment (day 5 marks the step blocked, which Jarvis turns into an
-- urgent alert through the existing mirror to Mission Control).

-- ── What has been sent to whom ──────────────────────────────────────────────
-- One row per reminder or alert, unique per client and kind, so a 15-minute job
-- can never email the same person twice.
create table if not exists public.client_reminders (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  kind        text not null,
  sent_at     timestamptz not null default now(),
  detail      jsonb not null default '{}'::jsonb,
  unique (company_id, kind)
);

alter table public.client_reminders enable row level security;
alter table public.client_reminders force row level security;
revoke all on table public.client_reminders from anon, authenticated;

-- ── The schedule ────────────────────────────────────────────────────────────
-- ql-hq had no scheduler until now. The job authenticates with a random secret
-- kept only in the vault as meta_watch_secret, generated in the database so
-- the value never lives in this repo. The function asks the database whether
-- the header matches, through a check only the service role can call.
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'meta_watch_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'meta_watch_secret');
  end if;
end $$;

create or replace function public.meta_watch_secret_ok(p text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'meta_watch_secret' and decrypted_secret = p
  )
$$;
revoke all on function public.meta_watch_secret_ok(text) from public, anon, authenticated;
grant execute on function public.meta_watch_secret_ok(text) to service_role;

select cron.schedule(
  'meta-access-watch',
  '*/15 * * * *',
  $$ select net.http_post(
       url     := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/meta-access-watch',
       headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'x-watch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_watch_secret')),
       body    := '{}'::jsonb,
       timeout_milliseconds := 60000) $$
);

-- Keep the job history short, as ql-mc does.
select cron.schedule(
  'cron-history-trim',
  '23 3 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '3 days' $$
);
