-- First lead ticks itself: the first lead a managed client receives, however it
-- arrived (Make, the API, the instant-lead endpoint, by hand), marks the
-- "First lead delivered" step done. A database trigger, so no lead route can
-- miss it. A step already done or skipped is left alone.
create or replace function public.tick_first_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prev text;
begin
  if new.company_id is null then return new; end if;
  if not exists (select 1 from companies where id = new.company_id and plan = 'managed') then return new; end if;
  select status into prev from company_fulfilment where company_id = new.company_id and step_key = 'first_lead';
  if prev in ('done', 'skipped') then return new; end if;

  insert into company_fulfilment (company_id, step_key, status, completed_at, completed_by_name, notes)
  values (new.company_id, 'first_lead', 'done', now(), 'Automation',
          left('First lead: ' || coalesce(new.source, 'unknown source'), 2000))
  on conflict (company_id, step_key) do update
    set status = 'done', completed_at = now(), completed_by = null, completed_by_name = 'Automation',
        notes = excluded.notes;

  insert into fulfilment_log (company_id, actor_id, actor_name, action, step_key, from_status, to_status, detail)
  values (new.company_id, null, 'Automation', 'fulfilment.step_set', 'first_lead', coalesce(prev, 'pending'), 'done',
          jsonb_build_object('notes', 'First lead arrived', 'lead_id', new.id));
  return new;
exception when others then
  -- A lead must never fail to save because of the checklist.
  raise warning 'tick_first_lead: %', sqlerrm;
  return new;
end $$;

create or replace trigger trg_tick_first_lead after insert on public.leads
  for each row execute function public.tick_first_lead();
