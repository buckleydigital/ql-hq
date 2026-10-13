-- =============================================================================
-- Managed companies get the shared SMS number on sign up
-- =============================================================================
-- Only a PPL purchase ever assigned the shared number (stripe-webhook ->
-- provision-twilio), so managed clients - who arrive through Stripe, growth
-- onboarding, sync-from-mc, create-user-silent or an admin plan change - were
-- left with no number at all until someone noticed.
--
-- A trigger rather than a call in each of those paths: they all end in the
-- companies row saying plan = 'managed', so this is the one place none of
-- them can miss. Managed only, deliberately: a PPL company must still reach
-- provision-twilio with no number, because that is what switches its AI on.
--
-- Same shape as provision-twilio and the admin bulk assign: a twilio_numbers
-- row with no twilio_sid (so it can never be released on Twilio), and the
-- agent config's sending number filled in only when blank. Never touches
-- is_active / auto_reply, and skips a company that already has any number.
--
-- Named to sort after auto_provision_sms, which creates the sms_agent_config
-- row this fills in (same-event triggers fire in name order).
-- =============================================================================

create or replace function public.assign_shared_number_to_managed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shared text;
begin
  if new.plan is distinct from 'managed' then
    return new;
  end if;
  if exists (select 1 from public.twilio_numbers where company_id = new.id) then
    return new;
  end if;

  select shared_ppl_twilio_number into shared from public.platform_settings where id = 1;
  if shared is null or shared = '' then
    return new;
  end if;

  insert into public.twilio_numbers (company_id, phone_number, friendly_name)
  values (new.id, shared, 'QuoteLeads SMS (shared PPL number)')
  on conflict (company_id, phone_number) do nothing;

  update public.sms_agent_config
     set twilio_number = shared
   where company_id = new.id
     and (twilio_number is null or twilio_number = '');

  return new;
end;
$$;

drop trigger if exists auto_provision_sms_shared_number on public.companies;
create trigger auto_provision_sms_shared_number
  after insert or update of plan on public.companies
  for each row
  execute function public.assign_shared_number_to_managed();
