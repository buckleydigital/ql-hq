-- "Pixel shared with us": a Team Panel step under Access & assets. The client
-- dashboard says we are setting the Pixel up, and only asks the client to act
-- when the team marks this step Blocked.
insert into public.fulfilment_step_defs (step_key, label, phase, sort_order, owner_role, required, sla_hours)
select 'pixel_shared', 'Pixel shared with us', 'onboarding', 42, 'client', false, 72
where not exists (select 1 from public.fulfilment_step_defs where step_key = 'pixel_shared');

-- The caller's own Pixel step status, for the dashboard. Clients cannot read
-- company_fulfilment, so only this one value is exposed.
create or replace function public.my_pixel_status()
returns text language sql stable security definer set search_path = public as $$
  select f.status from public.company_fulfilment f
   where f.step_key = 'pixel_shared'
     and f.company_id = (select company_id from public.profiles where id = auth.uid())
$$;
revoke all on function public.my_pixel_status() from public, anon;
grant execute on function public.my_pixel_status() to authenticated;
