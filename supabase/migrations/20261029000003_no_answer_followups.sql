-- No Answer, for clients' leads: a pipeline stage between New Lead and
-- Qualifying, and follow-ups on day 1, 3, 7 and 10 after a lead is moved
-- there, by text (from the client's number, using their SMS credits) and
-- email (in the client's name, replies to them). Off until the client, or the
-- team for them, switches it on; text and email can each be turned off, and
-- the four messages edited. Moving the lead out of No Answer, or the lead
-- texting back, stops them. Sent by no-answer-followups each morning.

alter type public.pipeline_stage add value if not exists 'no_answer' after 'new_lead';

-- When the lead reached its current stage, so "day 3 in No Answer" is known.
alter table public.leads add column if not exists pipeline_stage_changed_at timestamptz;

create or replace function public.leads_stamp_pipeline_stage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.pipeline_stage is distinct from old.pipeline_stage then
    new.pipeline_stage_changed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists leads_stamp_pipeline_stage on public.leads;
create trigger leads_stamp_pipeline_stage
  before insert or update of pipeline_stage on public.leads
  for each row execute function public.leads_stamp_pipeline_stage();

alter table public.sms_agent_config
  add column if not exists no_answer_enabled boolean not null default false,
  add column if not exists no_answer_sms boolean not null default true,
  add column if not exists no_answer_email boolean not null default true,
  add column if not exists no_answer_messages jsonb;   -- null: the defaults in no-answer-followups

-- What has gone, per lead, per time in No Answer, per step and channel.
create table if not exists public.no_answer_followup_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  entered_at timestamptz not null,
  step_day int not null,
  channel text not null check (channel in ('sms', 'email')),
  ok boolean not null,
  detail text,
  sent_at timestamptz not null default now(),
  unique (lead_id, entered_at, step_day, channel)
);
create index if not exists no_answer_followup_log_company on public.no_answer_followup_log (company_id, sent_at desc);
alter table public.no_answer_followup_log enable row level security;
create policy no_answer_followup_log_read on public.no_answer_followup_log for select to authenticated
  using (company_id in (select company_id from public.profiles where id = auth.uid()));

-- Each morning, 9:20 Sydney (22:20 UTC in summer, 23:20 in winter: both run,
-- the log stops a second send). Only calls out when a lead of a client with
-- it switched on is in No Answer and could have a step due.
select cron.schedule('no-answer-followups', '20 22,23 * * *', $job$
  select net.http_post(
    url := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/no-answer-followups',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-autopilot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
  where exists (
    select 1 from public.leads l join public.sms_agent_config c on c.company_id = l.company_id
     where l.pipeline_stage = 'no_answer' and c.no_answer_enabled
       and l.pipeline_stage_changed_at > now() - interval '12 days');
$job$);
