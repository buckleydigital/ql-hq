-- =============================================================================
-- QuoteLeadsHQ — New-lead notifications (email / SMS / email + SMS)
-- =============================================================================
-- Every user can choose to be alerted when ANY new lead lands in their
-- company's account (web form, API, Mission Control sync, manual add, etc.).
-- Mostly for managed advertising clients. Alerts are sent by the lead-notify
-- edge function (Resend for email, Twilio for SMS).
--
-- NO BACKFILL: existing profiles get lead_notify_enabled = false, so nothing
-- changes for accounts already running Make.com scenarios. The option just
-- sits in their settings until they (or an admin) switch it on.
-- New owner accounts created after this migration start switched on, sending
-- to the account email by default.
--
-- Destinations: a blank lead_notify_email / lead_notify_phone means "use the
-- email / phone on the account" (auth email / profiles.phone).
-- =============================================================================

alter table public.profiles
  add column if not exists lead_notify_enabled boolean not null default false,
  add column if not exists lead_notify_channel text    not null default 'email',
  add column if not exists lead_notify_email   text,
  add column if not exists lead_notify_phone   text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_lead_notify_channel_check'
  ) then
    alter table public.profiles
      add constraint profiles_lead_notify_channel_check
      check (lead_notify_channel in ('email', 'sms', 'email_sms'));
  end if;
end $$;

-- ── New owner accounts start switched on ─────────────────────────────────────
-- BEFORE INSERT only, so it never touches an existing profile (an upsert that
-- hits an existing row only updates the columns it names).
create or replace function public.default_lead_notify_on_new_owner()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'owner'
     and coalesce(new.user_type::text, 'external') <> 'internal' then
    new.lead_notify_enabled := true;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_default_lead_notify on public.profiles;
create trigger on_profile_default_lead_notify
  before insert on public.profiles
  for each row
  execute function public.default_lead_notify_on_new_owner();

-- ── Delivery log (also the dedupe key) ───────────────────────────────────────
create table if not exists public.lead_notification_log (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  company_id    uuid references public.companies(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  channel       text not null check (channel in ('email', 'sms')),
  destination   text,
  status        text not null default 'sending',  -- sending | sent | failed | skipped
  response_code int,
  response_body text,
  created_at    timestamptz not null default now(),
  unique (lead_id, profile_id, channel)
);

create index if not exists idx_lead_notification_log_company
  on public.lead_notification_log (company_id, created_at desc);

-- Service-role only (written by lead-notify, read via the admin API).
alter table public.lead_notification_log enable row level security;

-- ── Fire lead-notify for every new lead ──────────────────────────────────────
create or replace function public.notify_new_lead()
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
  v_service_key  text := nullif(current_setting('app.settings.service_role_key', true), '');
  v_headers      jsonb := jsonb_build_object('Content-Type', 'application/json');
begin
  -- Skip the HTTP call entirely unless someone in this company opted in.
  if not exists (
    select 1 from public.profiles
    where company_id = new.company_id
      and lead_notify_enabled = true
      and coalesce(is_active, true) = true
  ) then
    return new;
  end if;

  if v_service_key is not null then
    v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_service_key);
  end if;

  perform net.http_post(
    url     := v_supabase_url || '/functions/v1/lead-notify',
    headers := v_headers,
    body    := jsonb_build_object('lead_id', new.id)
  );

  return new;
exception
  when others then
    -- Never block a lead insert because of a notification problem.
    raise warning 'notify_new_lead failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_lead_created_notify on public.leads;
create trigger on_lead_created_notify
  after insert on public.leads
  for each row
  execute function public.notify_new_lead();
