-- More of the client's funnel to Meta, not just the sale: Schedule when an
-- appointment is booked for a lead, QuoteSent the first time a quote to a lead
-- is sent, alongside Purchase on closed_won. Meta learns from the stages that
-- happen often enough to optimise on. Each event goes once per lead, so
-- meta_capi_events is keyed by (lead, event).
alter table public.meta_capi_events drop constraint if exists meta_capi_events_pkey;
alter table public.meta_capi_events add primary key (lead_id, event_name);

-- One event for one lead to meta-capi, when the client has a pixel saved and
-- the lead isn't pay-per-lead (those are ours, not from the client's ads).
create or replace function public.send_meta_event(p_lead uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.leads l join public.companies c on c.id = l.company_id
    where l.id = p_lead and not coalesce(l.is_ppl, false) and c.meta_dataset_id is not null
  ) then
    return;
  end if;
  perform net.http_post(
    url     := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/meta-capi',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-autopilot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_secret')),
    body    := jsonb_build_object('action', 'send', 'lead_id', p_lead, 'event', p_event),
    timeout_milliseconds := 30000
  );
exception
  when others then
    raise warning 'send_meta_event % for %: %', p_event, p_lead, sqlerrm;
end;
$$;
revoke all on function public.send_meta_event(uuid, text) from public, anon, authenticated;

create or replace function public.send_meta_conversion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pipeline_stage::text = 'closed_won' and old.pipeline_stage::text is distinct from 'closed_won' then
    perform public.send_meta_event(new.id, 'Purchase');
  end if;
  return new;
end;
$$;

create or replace function public.send_meta_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_id is not null then
    perform public.send_meta_event(new.lead_id, 'Schedule');
  end if;
  return new;
end;
$$;
create trigger trg_send_meta_schedule
  after insert on public.appointments
  for each row execute function public.send_meta_schedule();

create or replace function public.send_meta_quote_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_id is not null and new.sent_at is not null
     and (tg_op = 'INSERT' or old.sent_at is null) then
    perform public.send_meta_event(new.lead_id, 'QuoteSent');
  end if;
  return new;
end;
$$;
create trigger trg_send_meta_quote_sent
  after insert or update of sent_at on public.quotes
  for each row execute function public.send_meta_quote_sent();
