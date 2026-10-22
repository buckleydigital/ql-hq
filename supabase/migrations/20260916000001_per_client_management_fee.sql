-- Per-client management subscription fee.
--
-- The management subscription was a fixed $600/mo hardcoded in
-- create-management-subscription. Some accounts are signed at a different
-- number, so the fee lives on the company now.
--
-- NULL means "the standard fee" rather than 60000, deliberately: an account on
-- list price should follow the list price if it ever changes, instead of being
-- pinned to whatever it happened to be on the day the row was created. Only a
-- row that has actually been negotiated carries a number.
--
-- The CHECK is the backstop for the validation in team-api: a fee cannot be
-- negative, and $50,000/mo is far above anything real, so a slipped decimal or
-- a dollars/cents mix-up fails here rather than becoming a Stripe charge.
alter table public.companies
  add column if not exists management_fee_cents integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname  = 'companies_management_fee_cents_check'
  ) then
    alter table public.companies
      add constraint companies_management_fee_cents_check
      check (management_fee_cents is null
             or (management_fee_cents >= 0 and management_fee_cents <= 5000000));
  end if;
end $$;

comment on column public.companies.management_fee_cents is
  'Monthly management fee in cents for this account. NULL = the standard fee (see MANAGEMENT_CENTS in create-management-subscription); 0 = management included at no charge.';
