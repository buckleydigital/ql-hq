-- =============================================================================
-- Fix: PPL area change request alert never sent
-- =============================================================================
-- The original trigger (20260621000002) built its URL and auth from
-- app.settings.supabase_url / app.settings.service_role_key, which are not set
-- on the hosted database, so it posted to a blank URL and failed silently.
-- It also targeted resend-email, which requires the service role key.
--
-- Now it calls notify-internal, which only ever emails
-- contact@quoteleads.com.au and needs no key. The message is HTML-escaped.
-- =============================================================================

create or replace function public.notify_ppl_area_change_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supabase_url text := coalesce(
    nullif(current_setting('app.settings.supabase_url', true), ''),
    'https://wjadekgptkstfdootuol.supabase.co'
  );
  v_company_name text;
  v_msg          text;
begin
  select name into v_company_name
  from public.companies
  where id = new.company_id;

  v_msg := replace(replace(replace(coalesce(new.message, '(no message)'),
             '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

  perform net.http_post(
    url     := v_supabase_url || '/functions/v1/notify-internal',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'subject', 'PPL Area Change Request — ' || coalesce(v_company_name, 'Unknown Company'),
      'body', '<html><body style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;padding:32px;color:#111827">'
        || '<h2 style="margin:0 0 16px">PPL Service Area Change Request</h2>'
        || '<p><strong>Company:</strong> ' || coalesce(v_company_name, 'Unknown') || '</p>'
        || '<p><strong>Message:</strong> ' || v_msg || '</p>'
        || '<p><strong>Submitted:</strong> ' || to_char(new.created_at at time zone 'Australia/Sydney', 'DD Mon YYYY HH24:MI') || ' AEST</p>'
        || '<p style="margin-top:24px"><a href="https://quoteleadshq.com/admin.html" style="color:#1f6fff">Review in Admin</a></p>'
        || '</body></html>'
    )
  );

  return new;
exception
  when others then
    raise warning 'notify_ppl_area_change_request failed: %', sqlerrm;
    return new;
end;
$$;
