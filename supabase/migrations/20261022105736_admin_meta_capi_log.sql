-- /admin's Meta Events log: every booking, quote and sale meta-capi has sent
-- (or is holding) for clients, with the client, the lead's name and where it
-- stands. Through a function because admins can't read other companies'
-- leads directly. Super admins only.
create or replace function public.admin_meta_capi_log(p_days int default 30, p_company uuid default null)
returns table (
  created_at timestamptz, sent_at timestamptz, company text, lead_name text, event_name text,
  value numeric, matched_by text[], state text, error text, attempts int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select e.created_at, e.sent_at, c.name, l.name, e.event_name, e.value, e.matched_by,
    case
      when e.sent_at is not null then 'sent'
      when e.error like 'Not sent:%' then 'skipped'
      when e.created_at < now() - interval '7 days' then 'expired'
      when e.error like 'Held:%' then 'waiting'
      when e.attempts >= 5 then 'gave up'
      else 'retrying'
    end,
    e.error, e.attempts
  from meta_capi_events e
  left join companies c on c.id = e.company_id
  left join leads l on l.id = e.lead_id
  where e.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
    and (p_company is null or e.company_id = p_company)
  order by e.created_at desc
  limit 500;
end;
$$;

revoke all on function public.admin_meta_capi_log(int, uuid) from public, anon;
grant execute on function public.admin_meta_capi_log(int, uuid) to authenticated;
