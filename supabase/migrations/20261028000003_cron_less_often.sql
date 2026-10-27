-- Fewer scheduled calls. Every pg_cron run that calls an edge function writes
-- a net.http_post request row and a net._http_response row, and those were
-- the heaviest writes on the database (disk IO budget warning). Most runs
-- found nothing to do, so these run less often:
--
--   campaign-autopilot, creative-autopilot   every 5 min  -> every 15 min
--   send-review-requests                     every 15 min -> every 30 min
--   meta-leads-subscribe                     every 30 min -> hourly
--
-- The creative autopilot carries a pack through all its stages in one run, so
-- running it less often barely slows a pack down.
select cron.alter_job(jobid, schedule := s.sched)
from cron.job j join (values
  ('campaign-autopilot',   '*/15 * * * *'),
  ('creative-autopilot',   '*/15 * * * *'),
  ('send-review-requests', '*/30 * * * *'),
  ('meta-leads-subscribe', '7 * * * *')
) as s(name, sched) on s.name = j.jobname;
