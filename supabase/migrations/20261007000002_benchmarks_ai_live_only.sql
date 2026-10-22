-- =============================================================================
-- Benchmarks: count a lead only while the AI was demonstrably live
-- =============================================================================
-- The automatic opener ("just confirming you're after a quote") is flagged
-- is_ai_generated but is sent even when auto-reply is OFF, so "AI sent a
-- message" isn't proof the AI was on. A lead now counts only if:
--   • the AI answered something the lead said, or
--   • the lead never replied, and the AI answered some other lead at the same
--     company within 7 days of this lead's opener (AI was live at the time).
-- Leads that replied and were never answered by AI (AI off / paused then) are
-- excluded.
--
-- Callback rate is only measured for businesses whose AI is in callback mode.
-- In quote-drafting mode the AI's goal is an estimate, not a callback, so a 0%
-- there would be a false comparison.
-- =============================================================================

-- Shared lead set for the benchmark and a company's own stats. SECURITY
-- INVOKER: callers only see rows RLS already allows; the SECURITY DEFINER
-- refresh function sees everything.
create or replace function public.ai_live_leads()
returns table (
  lead_id uuid, company_id uuid, ai_score numeric,
  replied boolean, callback_booked boolean, callback_mode boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with ai_msgs as (
    select c.lead_id, l.company_id, m.created_at
    from messages m
    join conversations c on c.id = m.conversation_id
    join leads l         on l.id = c.lead_id
    join companies co    on co.id = l.company_id
    where m.is_ai_generated
      and m.direction = 'outbound'
      and m.created_at >= co.created_at          -- ignore imported history
  ),
  inbound as (
    select c.lead_id, m.created_at
    from messages m
    join conversations c on c.id = m.conversation_id
    where m.direction = 'inbound' and c.lead_id is not null
  ),
  -- AI messages that answered something the lead said = AI was live
  live_replies as (
    select a.lead_id, a.company_id, a.created_at
    from ai_msgs a
    where exists (select 1 from inbound i where i.lead_id = a.lead_id and i.created_at < a.created_at)
  ),
  per_lead as (
    select
      a.lead_id, a.company_id, min(a.created_at) as first_ai_at,
      exists (select 1 from live_replies r where r.lead_id = a.lead_id) as answered
    from ai_msgs a
    group by a.lead_id, a.company_id
  ),
  scoped as (
    select
      p.*,
      exists (select 1 from inbound i where i.lead_id = p.lead_id and i.created_at > p.first_ai_at) as replied
    from per_lead p
  )
  select
    s.lead_id, s.company_id, l.ai_score::numeric, s.replied,
    exists (
      select 1 from appointments ap
      where ap.lead_id = s.lead_id and ap.booked_by = 'ai' and ap.appointment_type = 'callback'
    ),
    coalesce(cfg.callback_enabled, false) and not coalesce(cfg.quote_drafting_enabled, false)
  from scoped s
  join leads l on l.id = s.lead_id
  left join sms_agent_config cfg on cfg.company_id = s.company_id
  where s.answered
     or (not s.replied and exists (
           select 1 from live_replies r
           where r.company_id = s.company_id
             and r.created_at between s.first_ai_at - interval '7 days'
                                  and s.first_ai_at + interval '7 days'));
$$;

grant execute on function public.ai_live_leads() to authenticated;

create or replace function public.refresh_niche_benchmarks()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  last_update timestamptz;
  min_leads_per_business constant int := 10;
  min_businesses_niche   constant int := 10;
  min_businesses_all     constant int := 5;
begin
  select max(updated_at) into last_update from niche_benchmarks;

  -- Throttle: skip if refreshed within the last 6 hours
  if last_update is not null and last_update > now() - interval '6 hours' then
    return;
  end if;

  insert into niche_benchmarks (
    niche, company_count, ai_leads_analysed,
    avg_callback_rate, p25_callback_rate, p75_callback_rate,
    avg_reply_rate,    p25_reply_rate,    p75_reply_rate,
    avg_lead_score, updated_at
  )
  with eligible as (
    select
      co.id,
      lower(trim(co.name)) as business_key,
      coalesce(
        nullif(lower(regexp_replace(trim(co.niche), '[^a-zA-Z0-9]+', '_', 'g')), ''),
        (select o.niche from ppl_lead_orders o
          where o.company_id = co.id and o.status in ('paid','active','fulfilled')
          group by o.niche order by count(*) desc limit 1)
      ) as niche
    from companies co
    where coalesce((co.settings->>'allow_ai_training')::boolean, true)
      and not coalesce((co.settings->>'exclude_from_benchmarks')::boolean, false)
      and co.name is not null
  ),
  per_business as (
    select
      e.business_key,
      (array_agg(e.niche) filter (where e.niche is not null))[1]           as niche,
      count(*)::int                                                         as ai_leads,
      case when bool_and(al.callback_mode)
        then 100.0 * count(*) filter (where al.callback_booked) / count(*) end as callback_rate,
      100.0 * count(*) filter (where al.replied) / count(*)                 as reply_rate,
      case when count(*) filter (where al.ai_score > 0) >= 5
        then avg(al.ai_score) filter (where al.ai_score > 0) end            as lead_score
    from ai_live_leads() al
    join eligible e on e.id = al.company_id
    group by e.business_key
    having count(*) >= min_leads_per_business
  )
  select
    g.niche,
    count(*)::int,
    sum(b.ai_leads)::int,
    round(avg(b.callback_rate)::numeric, 2),
    round(percentile_cont(0.25) within group (order by b.callback_rate)::numeric, 2),
    round(percentile_cont(0.75) within group (order by b.callback_rate)::numeric, 2),
    round(avg(b.reply_rate)::numeric, 2),
    round(percentile_cont(0.25) within group (order by b.reply_rate)::numeric, 2),
    round(percentile_cont(0.75) within group (order by b.reply_rate)::numeric, 2),
    round(avg(b.lead_score)::numeric, 1),
    now()
  from per_business b
  cross join lateral (values (b.niche), ('_all')) g(niche)
  where g.niche is not null
  group by g.niche
  having count(*) >= case when g.niche = '_all' then min_businesses_all else min_businesses_niche end
  on conflict (niche) do update set
    company_count     = excluded.company_count,
    ai_leads_analysed = excluded.ai_leads_analysed,
    avg_callback_rate = excluded.avg_callback_rate,
    p25_callback_rate = excluded.p25_callback_rate,
    p75_callback_rate = excluded.p75_callback_rate,
    avg_reply_rate    = excluded.avg_reply_rate,
    p25_reply_rate    = excluded.p25_reply_rate,
    p75_reply_rate    = excluded.p75_reply_rate,
    avg_lead_score    = excluded.avg_lead_score,
    updated_at        = excluded.updated_at;

  -- Rows not refreshed this run no longer meet their threshold; zero them so
  -- the dashboard ignores them (it requires company_count >= threshold).
  update niche_benchmarks
     set company_count = 0
   where updated_at < now();
end;
$$;

create or replace function public.company_engagement_stats(p_company_id uuid)
returns table (ai_leads int, callback_rate numeric, reply_rate numeric, lead_score numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::int,
    case when bool_and(al.callback_mode) then
      round(100.0 * count(*) filter (where al.callback_booked) / nullif(count(*), 0), 1) end,
    round(100.0 * count(*) filter (where al.replied) / nullif(count(*), 0), 1),
    round(avg(al.ai_score) filter (where al.ai_score > 0), 0)
  from ai_live_leads() al
  where al.company_id = p_company_id;
$$;
