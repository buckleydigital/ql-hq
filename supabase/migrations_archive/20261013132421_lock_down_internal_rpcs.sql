-- =============================================================================
-- Stop the public API from calling internal SECURITY DEFINER functions
-- =============================================================================
-- Postgres grants EXECUTE on new functions to PUBLIC, so every function below
-- was callable through /rest/v1/rpc/* by anyone holding the anon key (which is
-- embedded in the website). Because they run as the owner they bypass RLS:
-- resolve_api_key / decrypt_api_key returned a company's provider API keys in
-- plain text, and add_sms_credits handed out free credits.
--
-- They are only ever called by edge functions with the service role key, or
-- by other SECURITY DEFINER functions (which run as the owner), so revoking
-- from PUBLIC, anon and authenticated breaks nothing. service_role keeps
-- access explicitly.
--
-- Left alone on purpose:
--   current_company_id, is_super_admin, has_permission, get_rep_visibility -
--     used inside RLS policies, so signed-in users must keep EXECUTE.
--   route_lead, get_ppl_dispute_eligibility, refresh_niche_benchmarks -
--     called from the dashboard as the signed-in user; anon access removed.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.add_sms_credits(uuid, integer)',
    'public.deduct_sms_credit(uuid)',
    'public.refund_sms_credit(uuid)',
    'public.reset_monthly_sms_credits()',
    'public.decrypt_api_key(bytea, uuid)',
    'public.encrypt_api_key(text, uuid)',
    'public.resolve_api_key(uuid, public.api_key_provider)',
    'public.get_auth_user_id_by_email(text)',
    'public.clean_expired_magic_links()',
    'public.get_ppl_scrub_usage(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  foreach fn in array array[
    'public.route_lead(uuid, text)',
    'public.get_ppl_dispute_eligibility(uuid)',
    'public.refresh_niche_benchmarks()'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;
