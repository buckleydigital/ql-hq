-- Two-way SMS between the team and their clients.
--
-- Deliberately its own number, its own webhook and its own table, sharing
-- nothing with the AI SMS pipeline. That pipeline answers +61485016260, matches
-- an inbound number against each company's LEADS, and hands the message to an AI
-- that talks to prospects. A client texting their account manager is none of
-- those things, and routing both down one pipe would mean a branch at the top of
-- the most sensitive function in the system deciding which kind of human just
-- texted - with the failure mode being an AI pitching solar to a paying client.
--
-- Two client numbers are also present in `leads`, so that is not hypothetical.
-- Separate number, separate everything: there is no decision to get wrong.

create table if not exists public.team_sms_message (
  id            uuid primary key default gen_random_uuid(),
  -- Null when an unrecognised number texts in. NOT dropped: the last time an
  -- inbound message had nowhere to go it was silently discarded, and the fix was
  -- to keep it and label it by the sender's number. Same rule here.
  company_id    uuid references public.companies(id) on delete set null,
  contact_id    uuid references auth.users(id) on delete set null,
  direction     text not null check (direction in ('inbound', 'outbound')),
  from_number   text not null,
  to_number     text not null,
  body          text not null default '',
  twilio_sid    text unique,
  status        text,
  error_code    text,
  -- Who sent it, for outbound only. An inbound message has no actor.
  actor_id      uuid references auth.users(id) on delete set null,
  actor_name    text,
  -- Null until somebody on the team has seen it. Only ever set on inbound:
  -- an outbound message is not something the team needs to be notified about.
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists team_sms_company_idx on public.team_sms_message (company_id, created_at desc);
-- Powers the unread badge, which runs on every poll, so it is worth an index of
-- its own. Partial: read messages are the overwhelming majority over time and
-- none of them can ever match.
create index if not exists team_sms_unread_idx on public.team_sms_message (created_at desc)
  where direction = 'inbound' and read_at is null;
create index if not exists team_sms_from_idx on public.team_sms_message (from_number, created_at desc);

-- Internal operational data holding clients' phone numbers and the contents of
-- their messages. Same three-lock pattern as the other internal tables: RLS
-- forced, no policies, API roles revoked. Reached only on the service role.
alter table public.team_sms_message enable row level security;
alter table public.team_sms_message force row level security;
revoke all on public.team_sms_message from anon, authenticated;

-- The number the team texts from. Separate from shared_ppl_twilio_number (the
-- AI's) and from outbound_caller_id, because there is no reason those three must
-- move together and every reason a wrong one should be obvious.
alter table public.platform_settings
  add column if not exists team_sms_number text;

update public.platform_settings
  set team_sms_number = coalesce(team_sms_number, outbound_caller_id)
  where id = 1;

-- Texting a client is its own permission, for the same reason calling is: it
-- speaks to a client in the agency's name. Granted deliberately, never inherited.
alter table public.team_role_permissions
  add column if not exists sms_send boolean not null default false;
