-- Closed sales back to Meta (Conversions API). A client who has put their
-- pixel / dataset ID in Settings (or the team has, in the Team Panel) gets a
-- Purchase event sent to it each time one of their leads moves to closed_won.
-- No dataset ID, no event: nothing fires for anyone else. Pay-per-lead leads
-- are ours, not from the client's ads, so they are never sent.
alter table public.companies add column if not exists meta_dataset_id text;
alter table public.companies drop constraint if exists companies_meta_dataset_id_digits;
alter table public.companies add constraint companies_meta_dataset_id_digits
  check (meta_dataset_id is null or meta_dataset_id ~ '^[0-9]{6,20}$');

-- One row per sale sent (or trying to be): the event is sent once per lead,
-- and a failure is retried by meta-capi until it has been tried five times.
create table if not exists public.meta_capi_events (
  lead_id     uuid primary key references public.leads(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  dataset_id  text not null,
  event_name  text not null default 'Purchase',
  value       numeric(12,2),
  matched_by  text[] not null default '{}',
  sent_at     timestamptz,
  error       text,
  attempts    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists meta_capi_events_company on public.meta_capi_events (company_id, created_at desc);
create index if not exists meta_capi_events_unsent on public.meta_capi_events (created_at) where sent_at is null;
alter table public.meta_capi_events enable row level security;
drop policy if exists "Users can view own company meta events" on public.meta_capi_events;
create policy "Users can view own company meta events" on public.meta_capi_events
  for select using (company_id = public.current_company_id());

create or replace function public.send_meta_conversion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pipeline_stage::text <> 'closed_won'
     or old.pipeline_stage::text is not distinct from 'closed_won'
     or coalesce(new.is_ppl, false) then
    return new;
  end if;
  if not exists (select 1 from public.companies where id = new.company_id and meta_dataset_id is not null) then
    return new;
  end if;

  perform net.http_post(
    url     := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/meta-capi',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-autopilot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_secret')),
    body    := jsonb_build_object('action', 'send', 'lead_id', new.id),
    timeout_milliseconds := 30000
  );
  return new;
exception
  when others then
    raise warning 'send_meta_conversion failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_send_meta_conversion on public.leads;
create trigger trg_send_meta_conversion
  after update of pipeline_stage on public.leads
  for each row execute function public.send_meta_conversion();

-- Every 30 minutes: send again any sale Meta didn't take.
select cron.schedule(
  'meta-capi-retry',
  '*/30 * * * *',
  $$ select net.http_post(
       url     := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/meta-capi',
       headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'x-autopilot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_secret')),
       body    := '{"action":"retry"}'::jsonb,
       timeout_milliseconds := 120000) $$
);
