-- =============================================================================
-- QuoteLeadsHQ — PPL Shared Twilio Number (platform_settings)
-- =============================================================================
-- Pay-per-lead (PPL) companies no longer get a dedicated Twilio number
-- provisioned per signup. Instead every PPL company is assigned the same
-- shared number (admin-configurable here instead of hardcoded), and inbound
-- replies are routed to the right company by matching the lead's phone
-- number (see twilio-inbound-sms). This table just holds that one setting.
-- =============================================================================

create table if not exists public.platform_settings (
  id                        smallint primary key default 1,
  shared_ppl_twilio_number  text not null default '+61485016260',
  updated_at                timestamptz default now(),
  constraint platform_settings_singleton check (id = 1)
);

insert into public.platform_settings (id) values (1) on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

-- Service-role only: read/written exclusively by provision-twilio and the
-- admin API (impersonate-user), both using the service role key which
-- bypasses RLS. No policy is added, so anon/authenticated clients get nothing.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'platform_settings' loop
    execute format('drop policy if exists %I on public.platform_settings', p.policyname);
  end loop;
end $$;
