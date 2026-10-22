-- =============================================================================
-- Phase 3: preview rounds, the client's approval link, and the autopilot
-- =============================================================================
-- A round is one set of ads shown to the client: built (copy, ad rules check),
-- drawn, checked by the team, sent, then approved or sent back with comments,
-- which starts the next round. Each round keeps its own copy of the ads, so
-- what the client approved is exactly what gets built in Meta, and every round
-- they saw stays on record.
-- =============================================================================

create table if not exists public.creative_rounds (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  round         int not null,
  -- building: the autopilot is writing or revising it (build_stage says where)
  -- drawing: copy is final, the images still need drawing in the Team Panel
  -- team_review: drawn and in Meta, waiting for the team to send it
  -- preparing: sent by the team, waiting for Meta to finish processing videos
  -- sent: with the client; approved / changes_requested: their answer
  -- superseded: replaced before the client answered
  status        text not null check (status in ('building', 'drawing', 'team_review', 'preparing', 'sent',
                  'approved', 'changes_requested', 'superseded')),
  build_stage   text,
  ads           jsonb not null default '[]'::jsonb,
  policy        jsonb,
  changes       jsonb,          -- what this round changed: { client, team }
  feedback      jsonb,          -- the client's answer: { ads: { key: { decision, comment } }, general }
  previews      jsonb,          -- Meta's preview links, cached: { at, items: { key: { format: url } } }
  reminders     jsonb not null default '{}'::jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  sent_by_name  text,
  decided_at    timestamptz,
  unique (company_id, round)
);
create index if not exists creative_rounds_status_idx on public.creative_rounds (status);
alter table public.creative_rounds enable row level security;
alter table public.creative_rounds force row level security;
revoke all on table public.creative_rounds from anon, authenticated;

-- The client's private link to their previews (quoteleadshq.com/approve.html?t=).
alter table public.companies add column if not exists approval_token text unique;

-- The autopilot's secret, generated here and kept only in the vault.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'autopilot_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'autopilot_secret');
  end if;
end $$;

create or replace function public.autopilot_secret_ok(p text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'autopilot_secret' and decrypted_secret = p
  )
$$;
revoke all on function public.autopilot_secret_ok(text) from public, anon, authenticated;
grant execute on function public.autopilot_secret_ok(text) to service_role;

-- Every 5 minutes: build packs that are due, revise from feedback, send what
-- Meta has finished processing, and chase clients who haven't answered. One
-- step of work per run, so no single run outlasts a function's time limit.
select cron.schedule(
  'creative-autopilot',
  '*/5 * * * *',
  $$ select net.http_post(
       url     := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/creative-rounds',
       headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'x-autopilot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_secret')),
       body    := '{"action":"autopilot"}'::jsonb,
       timeout_milliseconds := 150000) $$
);
