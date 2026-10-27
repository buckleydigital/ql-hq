-- Deleting a company failed: its checklist rows go with it, and each of those
-- deletes asked for the summary to be worked out again, for a company that no
-- longer exists, which the summary table's foreign key refuses. The trigger
-- now leaves a company that is gone alone (its summary row goes with it too).
create or replace function public.company_fulfilment_recalc()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if exists (select 1 from companies where id = coalesce(new.company_id, old.company_id)) then
    perform public.recalc_company_fulfilment(coalesce(new.company_id, old.company_id));
  end if;
  return null;
end;
$function$;
