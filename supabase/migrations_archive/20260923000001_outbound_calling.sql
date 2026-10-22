-- Outbound click-to-call from the Team Panel.
--
-- The team rings a client by pressing a button in the panel: Twilio calls the
-- team member's own mobile first, and when they answer it dials the client and
-- bridges the two. The client sees the agency's Twilio number.
--
-- Why the bridge rather than calling from the browser: the person doing this
-- work is in the Philippines. A bridge rings a real mobile, so it needs no
-- install, no headset and no dependable home internet - a dropped WebRTC call
-- mid-conversation with a paying client is worse than a phone that just works.

-- ── Who may place a call ───────────────────────────────────────────────────
-- A tenth capability rather than reusing an existing one. Placing a call spends
-- money and speaks to a client in the agency's name, so it is not implied by
-- being able to read a client's record, and it must be revocable on its own.
-- Default false for every role: this is granted deliberately in /admin, never
-- inherited.
alter table public.team_role_permissions
  add column if not exists calls_make boolean not null default false;

-- ── The log ────────────────────────────────────────────────────────────────
-- Every attempt, whether or not it connected. A call is the one action here
-- that leaves no trace in the product itself, so without this there is no way
-- to answer "who rang this client, when, and for how long".
create table if not exists public.call_log (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references public.companies(id) on delete set null,
  actor_id       uuid references auth.users(id) on delete set null,
  actor_name     text,
  -- Both ends, recorded as dialled. Kept verbatim rather than re-derived later,
  -- because a client's number can be edited after the call and the log has to
  -- say who was actually rung.
  agent_number   text not null,
  client_number  text not null,
  client_label   text,
  caller_id      text not null,
  twilio_call_sid text unique,
  -- Twilio's own vocabulary: queued, ringing, in-progress, completed, busy,
  -- failed, no-answer, canceled. Stored as text so a new Twilio status cannot
  -- break the insert.
  status         text not null default 'queued',
  duration_secs  integer,
  error_code     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists call_log_company_idx on public.call_log (company_id, created_at desc);
create index if not exists call_log_actor_idx   on public.call_log (actor_id, created_at desc);

-- ── Locked down ────────────────────────────────────────────────────────────
-- Internal operational data holding client phone numbers and who rang them.
-- No client may read it and no ordinary signed-in user has any business in it,
-- so it follows the same three-lock pattern as the other internal tables:
-- RLS forced, no policies, and the API roles revoked. team-api reaches it on
-- the service role, which RLS does not apply to.
alter table public.call_log enable row level security;
alter table public.call_log force row level security;
revoke all on public.call_log from anon, authenticated;

-- The caller ID clients see. Falls back to the shared PPL number, which is the
-- agency's number today, so this needs no seeding to work.
alter table public.platform_settings
  add column if not exists outbound_caller_id text;
