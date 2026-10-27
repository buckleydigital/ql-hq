-- RESET on a test account (companies.is_test) in the Team Panel: back to a
-- brand new client, so the fulfilment flow can be walked again from the top.
--
-- Clears the checklist and its log, preview rounds, campaign builds, preview
-- links, notes and everything generated for the client (ad copy, image copy,
-- the ad rules check, dates). Keeps the company itself, its niche and
-- onboarding answers, and the photos and logo already uploaded, so a re-run
-- does not start with re-uploading media. The Meta access link is dropped so
-- the access step can be tested again.
--
-- Refuses anything that is not a test account, whoever calls it.
create or replace function public.reset_test_company(p_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from companies where id = p_company and is_test) then
    raise exception 'Only a test account can be reset';
  end if;

  delete from company_fulfilment where company_id = p_company;
  delete from fulfilment_log     where company_id = p_company;
  delete from campaign_builds    where company_id = p_company;
  delete from creative_rounds    where company_id = p_company;
  delete from preview_links      where company_id = p_company;
  delete from client_notes       where company_id = p_company;

  update companies set
    generated_ad_copy = '{}'::jsonb,
    creative_copy = null,
    ad_policy_check = null,
    creative_note = null,
    approval_token = null,
    campaign_settings = '{}'::jsonb,
    dfy_profile = coalesce(dfy_profile, '{}'::jsonb) - 'meta_access',
    ads_live_date = null,
    management_included_from = null,
    next_invoice_due = null,
    invoice_status = 'none',
    intro_email_sent = false,
    intro_email_sent_at = null,
    updated_at = now()
  where id = p_company;

  perform recalc_company_fulfilment(p_company);
end;
$$;

revoke all on function public.reset_test_company(uuid) from public, anon, authenticated;
