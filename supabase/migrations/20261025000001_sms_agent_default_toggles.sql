-- Default AI toggles for new companies: AI enabled, auto reply, phone callbacks
-- and lead scoring on; out of hours only, on-site appointments and quote
-- drafting off. Every company (PPL and managed) gets the one shared Twilio
-- number at creation (assign_shared_number_to_company), so the AI is live from
-- day one; the first outbound SMS to a lead stays behind auto_send_welcome,
-- which provision-twilio turns on. Existing companies keep their settings.
alter table public.sms_agent_config
  alter column is_active            set default true,
  alter column auto_reply           set default true,
  alter column out_of_hours_only    set default false,
  alter column callback_enabled     set default true,
  alter column onsite_enabled       set default false,
  alter column quote_drafting_enabled set default false,
  alter column lead_scoring_enabled set default true;

CREATE OR REPLACE FUNCTION public.provision_sms_for_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    is_active,
    auto_reply,
    out_of_hours_only,
    callback_enabled,
    onsite_enabled,
    quote_drafting_enabled,
    lead_scoring_enabled
  )
  values (
    new.id,
    'Default SMS Agent',
    true,
    true,
    false,
    true,
    false,
    false,
    true
  )
  on conflict do nothing;

  return new;
end;
$function$
;
