-- Give lead-notify 30s (pg_net default is 5s) so a cold start can't cut a send short.
create or replace function public.notify_new_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supabase_url text := coalesce(
    nullif(current_setting('app.settings.supabase_url', true), ''),
    'https://wjadekgptkstfdootuol.supabase.co'
  );
  v_service_key  text := nullif(current_setting('app.settings.service_role_key', true), '');
  v_headers      jsonb := jsonb_build_object('Content-Type', 'application/json');
begin
  if not exists (
    select 1 from public.profiles
    where company_id = new.company_id
      and lead_notify_enabled = true
      and coalesce(is_active, true) = true
  ) then
    return new;
  end if;

  if v_service_key is not null then
    v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_service_key);
  end if;

  perform net.http_post(
    url     := v_supabase_url || '/functions/v1/lead-notify',
    headers := v_headers,
    body    := jsonb_build_object('lead_id', new.id),
    timeout_milliseconds := 30000
  );

  return new;
exception
  when others then
    raise warning 'notify_new_lead failed: %', sqlerrm;
    return new;
end;
$$;
