-- Review requests are scheduled by the database, not the browser, so a lead
-- marked Closed Won from anywhere (pipeline, sale modal, lead edit, API or
-- automation) gets one. send-review-request then texts it when it falls due,
-- run every 15 minutes by pg_cron.

-- One live request per lead. A skipped or failed one does not block a new one.
create unique index if not exists review_requests_one_live_per_lead
  on public.review_requests (lead_id)
  where status in ('pending', 'processing', 'sent');

create or replace function public.schedule_review_request_on_won()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg record;
  msg text;
begin
  if new.pipeline_stage::text is distinct from 'closed_won' then return new; end if;
  if tg_op = 'UPDATE' and old.pipeline_stage::text = 'closed_won' then return new; end if;
  if coalesce(new.phone, '') = '' then return new; end if;

  select review_enabled, review_delay_days, review_message, google_review_link
    into cfg
    from sms_agent_config
   where company_id = new.company_id;
  if not found or not coalesce(cfg.review_enabled, false) or coalesce(cfg.google_review_link, '') = '' then
    return new;
  end if;

  -- Same placeholders and default wording as the dashboard's review settings.
  -- Backslashes are doubled because they are special in a replacement string.
  msg := coalesce(nullif(cfg.review_message, ''),
         'Hi {{first_name}}, thank you for choosing us! We''d love your feedback - please leave us a Google review: {{review_link}}');
  msg := regexp_replace(msg, '\{\{first_name\}\}', replace(coalesce(nullif(new.first_name, ''), 'there'), '\', '\\'), 'gi');
  msg := regexp_replace(msg, '\{\{review_link\}\}', replace(cfg.google_review_link, '\', '\\'), 'gi');

  insert into review_requests (company_id, lead_id, status, scheduled_at, message_body)
  values (new.company_id, new.id, 'pending',
          now() + make_interval(days => greatest(coalesce(cfg.review_delay_days, 7), 0)), msg)
  on conflict (lead_id) where status in ('pending', 'processing', 'sent') do nothing;

  return new;
end;
$$;

revoke all on function public.schedule_review_request_on_won() from public, anon, authenticated;

drop trigger if exists schedule_review_request_on_won on public.leads;
create trigger schedule_review_request_on_won
  after insert or update of pipeline_stage on public.leads
  for each row execute function public.schedule_review_request_on_won();

select cron.schedule('send-review-requests', '*/15 * * * *', $cron$
  select net.http_post(
    url     := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/send-review-request',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-autopilot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000)
$cron$);
