-- Nothing calls Meta on a timer unless there is something to do.
--
-- The scheduled jobs that talk to Meta used to call their function every run,
-- and some of those (the access watch above all) asked Meta for the same lists
-- every 15 minutes whether or not anyone was waiting. Each job now checks the
-- database first and only calls its function when there is real work:
--
--   meta-access-watch   a real (not test) managed client still waiting on
--                       Meta access; then every 30 minutes, not 15
--   campaign-autopilot  a build queued or under way, or an approved round of a
--                       managed client with no build yet
--   meta-leads          a built campaign whose Page has never been subscribed
--                       (a failed subscribe is not retried on a timer), or a
--                       direct lead delivery still to retry
--   meta-capi-retry     a conversion event not sent yet, under 7 days old and
--                       under the attempt limit
--
-- The creative autopilot is unchanged: it only reaches Meta when a finished
-- round is being put into an ad account or a video is processing.

select cron.alter_job(
  (select jobid from cron.job where jobname = 'meta-access-watch'),
  schedule := '*/30 * * * *',
  command := $cmd$
    select net.http_post(
      url := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/meta-access-watch',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-watch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_watch_secret')),
      body := '{}'::jsonb, timeout_milliseconds := 60000)
    where exists (
      select 1 from companies c
      left join company_fulfilment f on f.company_id = c.id and f.step_key = 'ad_access_granted'
      where c.plan = 'managed' and not c.is_test and coalesce(f.status, 'pending') not in ('done', 'skipped'))
  $cmd$);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'campaign-autopilot'),
  command := $cmd$
    select net.http_post(
      url := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/campaign-build',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-autopilot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_secret')),
      body := '{"action":"autopilot"}'::jsonb, timeout_milliseconds := 150000)
    where exists (select 1 from campaign_builds where status in ('queued', 'building'))
       or exists (
         select 1 from creative_rounds r join companies c on c.id = r.company_id
         where r.status = 'approved' and c.plan = 'managed'
           and not exists (select 1 from campaign_builds b where b.company_id = r.company_id))
  $cmd$);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'meta-leads-subscribe'),
  command := $cmd$
    select net.http_post(
      url := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/meta-leads',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-autopilot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_secret')),
      body := '{"action":"subscribe"}'::jsonb, timeout_milliseconds := 120000)
    where exists (select 1 from campaign_builds where status = 'built' and meta->'page_subscribed' is null)
       or exists (select 1 from meta_leads where delivery = 'direct' and lead_id is null and attempts < 5)
  $cmd$);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'meta-capi-retry'),
  command := $cmd$
    select net.http_post(
      url := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/meta-capi',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-autopilot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_secret')),
      body := '{"action":"retry"}'::jsonb, timeout_milliseconds := 120000)
    where exists (select 1 from meta_capi_events
                  where sent_at is null and attempts < 5 and created_at > now() - interval '7 days')
  $cmd$);
