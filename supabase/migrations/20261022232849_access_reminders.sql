-- The Team Panel's "Stop reminders" on the Meta access step: whether
-- meta-access-watch may still email the client on day 2 and day 4 about giving
-- us access (client_reminders kind 'access_reminders_off' says it may not).
-- Admins, and team members who can see (to read) or edit (to change) this
-- client's fulfilment, same as team-api's rules.
create or replace function public.can_fulfil(p_company uuid, p_edit boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin() or exists (
    select 1 from profiles p
    left join team_role_permissions r on r.role = coalesce(p.team_role, 'csm')
    where p.id = auth.uid() and p.is_team
      and coalesce(r.fulfilment_view, false)
      and (not p_edit or coalesce(r.fulfilment_edit, false))
      and (coalesce(r.all_clients, false)
           or exists (select 1 from team_assignments a where a.team_user_id = p.id and a.company_id = p_company))
  );
$$;
revoke all on function public.can_fulfil(uuid, boolean) from public, anon;

create or replace function public.access_reminders_off(p_company uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_fulfil(p_company, false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return exists (select 1 from client_reminders where company_id = p_company and kind = 'access_reminders_off');
end;
$$;

create or replace function public.set_access_reminders(p_company uuid, p_off boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := (select coalesce(full_name, 'Team') from profiles where id = auth.uid());
begin
  if not public.can_fulfil(p_company, true) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_off then
    if not exists (select 1 from client_reminders where company_id = p_company and kind = 'access_reminders_off') then
      insert into client_reminders (company_id, kind, detail) values (p_company, 'access_reminders_off', jsonb_build_object('by', v_name));
    end if;
  else
    delete from client_reminders where company_id = p_company and kind = 'access_reminders_off';
  end if;
  insert into fulfilment_log (company_id, actor_id, actor_name, action)
  values (p_company, auth.uid(), v_name, case when p_off then 'meta_access.reminders_off' else 'meta_access.reminders_on' end);
  return p_off;
end;
$$;

revoke all on function public.access_reminders_off(uuid) from public, anon;
revoke all on function public.set_access_reminders(uuid, boolean) from public, anon;
grant execute on function public.access_reminders_off(uuid) to authenticated;
grant execute on function public.set_access_reminders(uuid, boolean) to authenticated;
