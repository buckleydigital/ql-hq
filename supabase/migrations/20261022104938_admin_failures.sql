-- What has gone wrong lately, in one place for /admin's System Health panel:
-- each background job, send and sync that records its failures, read back
-- here so nobody has to go looking. Super admins only.
--
-- Each item: source, severity ('error' or 'warning'), title, detail, company,
-- count and the last time it happened. Edge function errors that never reach
-- the database (only the function logs) aren't covered.
create or replace function public.admin_failures(p_days int default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)));
  v_out jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  with items as (
    -- Scheduled jobs that errored in the database.
    select 'Scheduled jobs' as source, 'error' as severity, 'Job "' || j.jobname || '" failed' as title,
      left(max(d.return_message), 300) as detail, null::text as company, count(*) as n, max(d.start_time) as at
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.status = 'failed' and d.start_time >= v_since
    group by j.jobname

    -- Calls from the database to edge functions (scheduled jobs, triggers)
    -- that came back with an error. Supabase keeps these for about 6 hours.
    union all
    select 'Background calls', 'error',
      case when r.timed_out then 'Edge function call timed out'
           when r.error_msg is not null then 'Edge function call failed'
           else 'Edge function returned HTTP ' || r.status_code end,
      left(max(coalesce(r.error_msg, r.content)), 300), null, count(*), max(r.created)
    from net._http_response r
    where r.created >= v_since and (r.timed_out or r.error_msg is not null or r.status_code >= 400)
    group by r.timed_out, r.error_msg is not null, r.status_code

    -- Meta lead form leads that didn't make it into QuoteLeads.
    union all
    select 'Meta lead intake', 'error', 'Lead form lead not imported', left(max(m.error), 300), c.name, count(*), max(m.created_at)
    from meta_leads m left join companies c on c.id = m.company_id
    where m.error is not null and m.lead_id is null and m.created_at >= v_since
    group by c.name

    -- Bookings, quotes and sales Meta refused (held ones are waiting, not failed).
    union all
    select 'Meta sales tracking', 'error', e.event_name || ' not accepted by Meta', left(max(e.error), 300), c.name, count(*), max(e.created_at)
    from meta_capi_events e left join companies c on c.id = e.company_id
    where e.sent_at is null and e.error is not null and e.error not like 'Held:%' and e.created_at >= v_since
    group by e.event_name, c.name

    -- Managed clients whose pixel is saved but can't be reached.
    union all
    select 'Meta sales tracking', 'warning', 'Pixel not connected', left(c.meta_dataset_error, 300), c.name, 1, c.updated_at
    from companies c
    where c.plan = 'managed' and c.meta_dataset_id is not null
      and c.meta_dataset_connected is distinct from c.meta_dataset_id

    -- Campaign builds and creative rounds.
    union all
    select 'Campaign builds', case when b.status = 'failed' then 'error' else 'warning' end,
      case when b.status = 'failed' then 'Campaign build failed' else 'Campaign build needs the team' end,
      left(b.error, 300), c.name, 1, b.updated_at
    from campaign_builds b left join companies c on c.id = b.company_id
    where b.status in ('failed', 'needs_team') and b.updated_at >= v_since

    union all
    select 'Creative rounds', 'error', 'Creative round ' || r.round || ' hit an error', left(r.error, 300), c.name, 1, r.created_at
    from creative_rounds r left join companies c on c.id = r.company_id
    where r.error is not null and r.created_at >= v_since

    -- AI replies, qualifying and other workflows.
    union all
    select 'AI workflows', 'error', 'AI ' || replace(w.workflow_type, '_', ' ') || ' failed', left(max(w.error_text), 300), c.name, count(*), max(w.created_at)
    from ai_workflow_runs w left join companies c on c.id = w.company_id
    where w.status = 'failed' and w.created_at >= v_since
    group by w.workflow_type, c.name

    -- New-lead emails and texts to clients.
    union all
    select 'Lead notifications', 'error',
      case when l.status = 'failed' then 'New-lead ' || l.channel || ' failed' else 'New-lead ' || l.channel || ' stuck sending' end,
      left(max(l.response_body), 300), c.name, count(*), max(l.created_at)
    from lead_notification_log l left join companies c on c.id = l.company_id
    where l.created_at >= v_since
      and (l.status = 'failed' or (l.status = 'sending' and l.created_at < now() - interval '15 minutes'))
    group by l.status, l.channel, c.name

    -- Texts and calls from the team. A sent text stays 'queued' (what Twilio
    -- says when it takes it): nothing reports delivery back, so that's not a
    -- failure, only Twilio refusing it is.
    union all
    select 'Team SMS', 'error', 'Text ' || coalesce(s.status, 'failed'),
      'Error code ' || coalesce(max(s.error_code), 'none'), c.name, count(*), max(s.created_at)
    from team_sms_message s left join companies c on c.id = s.company_id
    where s.direction = 'outbound' and s.created_at >= v_since
      and (s.error_code is not null or s.status in ('failed', 'undelivered'))
    group by s.status, c.name

    union all
    select 'Calls', 'error', 'Call ' || coalesce(k.status, 'failed'), 'Error code ' || coalesce(max(k.error_code), 'none'), c.name, count(*), max(k.created_at)
    from call_log k left join companies c on c.id = k.company_id
    where k.created_at >= v_since and (k.error_code is not null or k.status = 'failed')
    group by k.status, c.name

    -- Sign-ups that hit an error on the way to an account.
    union all
    select 'Onboarding', 'error', 'Onboarding error for ' || coalesce(nullif(trim(coalesce(o.company, '')), ''), o.email, 'a sign-up'),
      left(o.last_error, 300), null, 1, o.error_at
    from onboarding_submissions o
    where o.last_error is not null and o.error_at >= v_since

    -- Clients' own webhooks we couldn't deliver to.
    union all
    select 'Client webhooks', 'warning', 'Webhook "' || w.event || '" not delivered',
      'HTTP ' || coalesce(max(w.response_status)::text, 'no response'), c.name, count(*), max(w.created_at)
    from webhook_deliveries w left join companies c on c.id = w.company_id
    where not w.success and w.created_at >= v_since
    group by w.event, c.name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'source', source, 'severity', severity, 'title', title, 'detail', detail,
      'company', company, 'count', n, 'at', at)
    order by (severity = 'error') desc, at desc nulls last), '[]'::jsonb)
  into v_out
  from items;
  return v_out;
end;
$$;

revoke all on function public.admin_failures(int) from public, anon;
grant execute on function public.admin_failures(int) to authenticated;
