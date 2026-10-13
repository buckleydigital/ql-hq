-- =============================================================================
-- Enforce the QuoteLeads PPL lead lock in the database
-- =============================================================================
-- The dashboard only lets clients change status, value, address and notes on a
-- lead whose source is 'QuoteLeads PPL', and never delete one - but that was
-- enforced only in the browser, so a direct API call (or a stale page) could
-- rewrite a purchased lead's contact details or delete it.
--
-- For signed-in clients (role 'authenticated', not a super-admin) this:
--   * silently keeps the identifying fields unchanged on update, matching what
--     the dashboard already does, so legitimate edits still save; and
--   * refuses to delete the lead.
-- Edge functions (service role), direct SQL and super-admins are unaffected.
-- The trigger name sorts after the other BEFORE UPDATE triggers on leads so it
-- runs last and also undoes anything they derived from the blocked fields.

create or replace function public.enforce_ppl_lead_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' or public.is_super_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if lower(trim(coalesce(old.source, ''))) <> 'quoteleads ppl' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'QuoteLeads PPL leads can''t be deleted.'
      using errcode = '42501';
  end if;

  new.name        := old.name;
  new.first_name  := old.first_name;
  new.last_name   := old.last_name;
  new.email       := old.email;
  new.phone       := old.phone;
  new.source      := old.source;
  new.postcode    := old.postcode;
  new.is_ppl      := old.is_ppl;
  new.custom_data := old.custom_data;
  return new;
end;
$$;

drop trigger if exists zz_enforce_ppl_lead_lock on public.leads;
create trigger zz_enforce_ppl_lead_lock
  before update or delete on public.leads
  for each row execute function public.enforce_ppl_lead_lock();
