-- =============================================================================
-- AI SMS on by default for new signups
-- =============================================================================
-- New companies used to start with the SMS agent switched off (is_active and
-- auto_reply false), so leads were never answered until the client found the
-- toggle. Pay-per-lead buyers with AI on convert far more leads to a yes, so
-- a new company now starts with AI on: active, auto-reply, callbacks (the
-- minimum the dashboard enforces when AI is active) and lead scoring.
-- Existing companies are not touched.
-- =============================================================================

create or replace function public.provision_sms_for_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sms_credits (
    company_id,
    balance,
    monthly_free_sms,
    next_reset_at
  )
  values (
    new.id,
    500,
    500,
    now() + interval '30 days'
  )
  on conflict (company_id) do nothing;

  insert into public.sms_agent_config (
    company_id,
    name,
    auto_reply,
    is_active,
    callback_enabled,
    lead_scoring_enabled
  )
  values (
    new.id,
    'Default SMS Agent',
    true,
    true,
    true,
    true
  )
  on conflict do nothing;

  return new;
end;
$$;
