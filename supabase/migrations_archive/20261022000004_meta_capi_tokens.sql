-- Sales tracking without our Meta app: each client generates a Conversions API
-- token for their own pixel in their Events Manager (pixel > Settings >
-- Conversions API > Generate access token) and meta-capi sends with that, so
-- no pixel sharing, no system user and no app verification are involved.
--
-- The token lives in the vault; this table only says which secret is whose,
-- and has no policies, so only the service role (meta-capi) reaches it.
-- meta_dataset_connected / meta_dataset_error now say whether that token can
-- reach the pixel, checked by meta-capi when either is saved.
create table if not exists public.company_capi_tokens (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  secret_id   uuid not null,
  updated_at  timestamptz not null default now()
);
alter table public.company_capi_tokens enable row level security;

-- Save (or, with an empty token, blank out) a company's token.
create or replace function public.set_company_capi_token(p_company uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret uuid;
begin
  select secret_id into v_secret from public.company_capi_tokens where company_id = p_company;
  if v_secret is null then
    v_secret := vault.create_secret(coalesce(p_token, ''), 'capi_token_' || p_company::text);
    insert into public.company_capi_tokens (company_id, secret_id) values (p_company, v_secret);
  else
    perform vault.update_secret(v_secret, coalesce(p_token, ''));
    update public.company_capi_tokens set updated_at = now() where company_id = p_company;
  end if;
end;
$$;

create or replace function public.get_company_capi_token(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(s.decrypted_secret, '')
  from public.company_capi_tokens t join vault.decrypted_secrets s on s.id = t.secret_id
  where t.company_id = p_company
$$;

revoke all on function public.set_company_capi_token(uuid, text) from public, anon, authenticated;
revoke all on function public.get_company_capi_token(uuid) from public, anon, authenticated;
grant execute on function public.set_company_capi_token(uuid, text) to service_role;
grant execute on function public.get_company_capi_token(uuid) to service_role;
