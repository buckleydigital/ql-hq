-- =============================================================================
-- Every company gets the shared SMS number on sign up
-- =============================================================================
-- +61485016260 (platform_settings.shared_ppl_twilio_number) is the default
-- number for every client, whatever their plan. Until now only a PPL purchase
-- assigned it (stripe-webhook -> provision-twilio), so managed and free
-- clients - who arrive through Stripe, growth onboarding, sync-from-mc,
-- create-user-silent or an admin - were left with no number at all until
-- someone noticed.
--
-- A trigger rather than a call in each of those paths, so none can miss it.
-- Assigning the number does not switch the AI on: provision-twilio still does
-- that on a PPL purchase, and no longer skips a company just because it
-- already has the number. Clients only ever see texts from their own leads:
-- twilio-inbound-sms routes every message on the shared number by matching
-- the sender against each company's leads.
--
-- Same shape as provision-twilio and the admin bulk assign: a twilio_numbers
-- row with no twilio_sid (so it can never be released on Twilio), and the
-- agent config's sending number filled in only when blank. Never touches
-- is_active / auto_reply, and skips a company that already has any number.
--
-- Named to sort after auto_provision_sms, which creates the sms_agent_config
-- row this fills in (same-event triggers fire in name order).
-- =============================================================================

drop trigger if exists auto_provision_sms_shared_number on public.companies;
drop function if exists public.assign_shared_number_to_managed();

create or replace function public.assign_shared_number_to_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shared text;
begin
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

create trigger auto_provision_sms_shared_number
  after insert on public.companies
  for each row
  execute function public.assign_shared_number_to_company();
