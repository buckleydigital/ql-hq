-- =============================================================================
-- Niche benchmarks v2 — AI engagement only
-- =============================================================================
-- Rebuilds niche_benchmarks so it measures ONLY what the AI actually did:
--
--   • A lead counts only if the AI really messaged it (an is_ai_generated
--     outbound message exists). Leads that arrived while AI was switched off
--     never got an AI message, so they can't drag the averages down.
--   • AI messages dated before the company existed (imported history) are
--     ignored.
--   • Closed-deal data (win rate, deal value) is removed entirely — clients
--     keep that private. Benchmarks are engagement metrics only.
--   • Contribution is opt-out: every company is included unless it has
--     switched the toggle off (settings.allow_ai_training = false) or is
--     flagged internal/test (settings.exclude_from_benchmarks = true).
--   • Accounts with the same business name are pooled as one contributor so
--     a business with several logins isn't counted twice.
--   • A business needs >= 10 AI-handled leads to contribute.
--   • Rows: one per niche (published at 10+ businesses) plus a cross-trade
--     '_all' row (published at 5+ businesses) that the dashboard falls back to.
-- =============================================================================

delete from public.niche_benchmarks;

alter table public.niche_benchmarks
  drop column if exists avg_ai_coverage,
  drop column if exists avg_win_rate,
  drop column if exists p25_win_rate,
  drop column if exists p75_win_rate,
  drop column if exists avg_deal_value,
  add column if not exists ai_leads_analysed int not null default 0,
  add column if not exists avg_reply_rate    decimal(5,2),  -- % AI-contacted leads that replied
  add column if not exists p25_reply_rate    decimal(5,2),
  add column if not exists p75_reply_rate    decimal(5,2);

comment on column public.niche_benchmarks.avg_callback_rate is
  '% of AI-handled leads where the AI booked a callback';
comment on column public.niche_benchmarks.avg_lead_score is
  'Avg AI lead score /100 across scored AI-handled leads';

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
      co.created_at,
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
  -- Leads the AI genuinely handled, with the time of its first message
  ai_leads as (
    select l.id, l.company_id, l.ai_score, min(m.created_at) as first_ai_at
    from messages m
    join conversations c on c.id = m.conversation_id
    join leads l        on l.id = c.lead_id
    join eligible e     on e.id = l.company_id
    where m.is_ai_generated
      and m.direction = 'outbound'
      and m.created_at >= e.created_at
    group by l.id, l.company_id, l.ai_score
  ),
  lead_stats as (
    select
      al.*,
      exists (
        select 1 from appointments ap
        where ap.lead_id = al.id and ap.booked_by = 'ai' and ap.appointment_type = 'callback'
      ) as callback_booked,
      exists (
        select 1 from messages m
        join conversations c on c.id = m.conversation_id
        where c.lead_id = al.id and m.direction = 'inbound' and m.created_at > al.first_ai_at
      ) as replied
    from ai_leads al
  ),
  per_business as (
    select
      e.business_key,
      (array_agg(e.niche) filter (where e.niche is not null))[1]           as niche,
      count(*)::int                                                         as ai_leads,
      100.0 * count(*) filter (where ls.callback_booked) / count(*)         as callback_rate,
      100.0 * count(*) filter (where ls.replied)         / count(*)         as reply_rate,
      case when count(*) filter (where ls.ai_score > 0) >= 5
        then avg(ls.ai_score) filter (where ls.ai_score > 0) end            as lead_score
    from lead_stats ls
    join eligible e on e.id = ls.company_id
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

grant execute on function public.refresh_niche_benchmarks() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- company_engagement_stats(company_id)
--
-- The caller's own numbers, measured exactly like the benchmark (AI-messaged
-- leads only) so the AI Insights comparison is like-for-like. SECURITY
-- INVOKER: existing RLS limits callers to companies they can already see.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.company_engagement_stats(p_company_id uuid)
returns table (ai_leads int, callback_rate numeric, reply_rate numeric, lead_score numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with ai_leads as (
    select l.id, l.ai_score, min(m.created_at) as first_ai_at
    from messages m
    join conversations c on c.id = m.conversation_id
    join leads l        on l.id = c.lead_id
    join companies co   on co.id = l.company_id
    where l.company_id = p_company_id
      and m.is_ai_generated
      and m.direction = 'outbound'
      and m.created_at >= co.created_at
    group by l.id, l.ai_score
  )
  select
    count(*)::int,
    round(100.0 * count(*) filter (where exists (
      select 1 from appointments ap
      where ap.lead_id = al.id and ap.booked_by = 'ai' and ap.appointment_type = 'callback'
    )) / nullif(count(*), 0), 1),
    round(100.0 * count(*) filter (where exists (
      select 1 from messages m
      join conversations c on c.id = m.conversation_id
      where c.lead_id = al.id and m.direction = 'inbound' and m.created_at > al.first_ai_at
    )) / nullif(count(*), 0), 1),
    round(avg(al.ai_score) filter (where al.ai_score > 0), 0)
  from ai_leads al;
$$;

grant execute on function public.company_engagement_stats(uuid) to authenticated;
