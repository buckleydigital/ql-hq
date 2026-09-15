-- ════════════════════════════════════════════════════════════════════════════
-- Internal Team: rename off "VA", and track + log fulfilment
--
-- TWO CHANGES THAT HAVE TO SHIP TOGETHER
--
--   1. The people doing this work are the Internal Team - CSMs, ops managers,
--      media buyers - not "VAs". The old name undersold the job and the new
--      tables would have inherited it, so the rename goes first and everything
--      below is built on the new names. Renaming in a later migration would
--      have meant shipping a vocabulary we already knew was wrong.
--
--   2. Fulfilment gets real tracking and a real audit trail.
--
-- WHERE THE WORK LIVES (and why this is the right repo for it)
--   ql-mc is admin + sales reps, reps gated as they are now. Everyone who
--   actually fulfils - CSM, ops manager, media buyer - works here, in the Team
--   Panel at /team-panel. So the step state and the log live here, where the
--   click happens and where the actor identity exists. ql-mc keeps the
--   management roll-up and is fed a derived summary through its existing
--   sync-from-hq bridge. One writer, one reader, no ambiguity about which side
--   is authoritative.
--
-- THE GAP THIS CLOSES
--   The pipeline lived in ql-mc as two mutable text columns on `clients`
--   (onboarding_sub_stage, active_status). Change one and the old value was
--   gone: no timestamp, no actor, no history. Meanwhile of the ~25 mutating
--   actions in the panel's edge function, exactly one left a record
--   (client_email_log).
--
-- WHY NOT activity_log
--   It already has the right shape and is the wrong home: it carries the policy
--   "Company members can view activity" (20260401000000_initial_schema.sql), so
--   anything written there is readable by the client it is about. Internal
--   notes, blocked reasons and actor names are not for the client.
--
-- NOTHING HERE IS VISIBLE TO A CLIENT
--   Three independent locks, so no single mistake later opens it up:
--     1. RLS enabled and FORCED, with NO permissive policy. Nothing to match.
--     2. All privileges REVOKED from anon and authenticated, and from PUBLIC.
--        Supabase grants those roles table privileges on public by default, so
--        revoking is what makes lock 1 hard to undo by accident: adding a
--        policy later still grants nothing without a GRANT as well.
--     3. No client-facing table gains a fulfilment column. The derived summary
--        lives in its own locked table, NOT on `companies`, because a company
--        row is readable by its own members - a column there would have shown
--        the pipeline in the client's dashboard.
--   Everything goes through the team-api edge function under the service role,
--   which bypasses RLS by design and enforces the is_team / team_role /
--   assignment checks itself. Locks 1 and 2 are also retro-fitted onto
--   team_assignments, client_notes, client_email_log and team_availability,
--   which until now relied on the absence of a policy alone.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0. Rename VA → Internal Team ───────────────────────────────────────────
-- Every rename is guarded on the old name still being there, so this migration
-- is safe to re-run and safe on a database that has already been renamed.
-- Renaming a column carries its constraints, policies and indexes with it, so
-- the only real work is the code, which moves in the same commit.
DO $$
BEGIN
  -- profiles.is_va → is_team
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='profiles' AND column_name='is_va')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='profiles' AND column_name='is_team') THEN
    ALTER TABLE public.profiles RENAME COLUMN is_va TO is_team;
  END IF;

  -- profiles.va_reply_to_email → team_reply_to_email
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='profiles' AND column_name='va_reply_to_email')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='profiles' AND column_name='team_reply_to_email') THEN
    ALTER TABLE public.profiles RENAME COLUMN va_reply_to_email TO team_reply_to_email;
  END IF;

  -- va_assignments → team_assignments (+ its user column)
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='va_assignments')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='team_assignments') THEN
    ALTER TABLE public.va_assignments RENAME TO team_assignments;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='team_assignments' AND column_name='va_user_id') THEN
    ALTER TABLE public.team_assignments RENAME COLUMN va_user_id TO team_user_id;
  END IF;

  -- va_availability → team_availability (+ its user column)
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='va_availability')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='team_availability') THEN
    ALTER TABLE public.va_availability RENAME TO team_availability;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='team_availability' AND column_name='va_user_id') THEN
    ALTER TABLE public.team_availability RENAME COLUMN va_user_id TO team_user_id;
  END IF;

  -- companies.intro_email_sent → intro_email_sent. The step table below is now the
  -- real record of this; the column stays because 20260705000014 and the
  -- billing panel read it, and team-api keeps the two in step.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='companies' AND column_name='va_intro_done')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='companies' AND column_name='intro_email_sent') THEN
    ALTER TABLE public.companies RENAME COLUMN va_intro_done TO intro_email_sent;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='companies' AND column_name='va_intro_done_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='companies' AND column_name='intro_email_sent_at') THEN
    ALTER TABLE public.companies RENAME COLUMN va_intro_done_at TO intro_email_sent_at;
  END IF;
END $$;

-- Indexes keep working under their old names; renaming them is cosmetic but
-- stops the next person grepping for "team_assignments" and finding nothing.
ALTER INDEX IF EXISTS idx_va_assignments_va      RENAME TO idx_team_assignments_user;
ALTER INDEX IF EXISTS idx_va_assignments_company RENAME TO idx_team_assignments_company;

COMMENT ON TABLE public.team_assignments IS
  'Which client companies each Internal Team member manages. Was va_assignments.';
COMMENT ON TABLE public.team_availability IS
  'Weekly call availability per Internal Team member. Was va_availability.';

-- ─── 1. Who is on the team, and in what job ─────────────────────────────────
-- `is_team` = on the Internal Team at all. `team_role` = what they do, using
-- the same closed set ql-mc already uses for its roster
-- (20260901000004_team_members.sql), so one person has one job title across
-- both systems rather than two that drift.
--
-- Scope follows from the job rather than being configured separately: an
-- ops_manager sees every client because that is the job; everyone else sees the
-- clients assigned to them. That is deliberately a tier inside one surface
-- rather than a second account type - the difference is scope and authority,
-- not which data they touch - and it keeps one flag, one edge function, one
-- portal instead of a parallel set of each.
--
-- Creating a team member stays admin-only: an ops_manager directs the work
-- without being able to widen who does it.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS team_role text NOT NULL DEFAULT 'csm';

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_team_role_check
    CHECK (team_role IN ('csm','ops_manager','media_buyer','tech_lead'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.profiles.is_team IS
  'On the Internal Team (the Team Panel at /team-panel). Was is_va.';
COMMENT ON COLUMN public.profiles.team_role IS
  'Internal Team job, only meaningful when is_team. Mirrors ql-mc team_members.role. ops_manager sees every client; everyone else sees their assignments.';

-- A client must never be able to put themselves on the team, or promote
-- themselves to ops_manager. 20260401000027 pins role, company_id and
-- user_type on self-update; is_team, is_admin and team_role postdate it and
-- were not covered, so the self-update policy is replaced with one that pins
-- them too. Only the service role (team-api, admin-checked) may change them.
DROP POLICY IF EXISTS "Users can update own profile safe fields" ON public.profiles;
CREATE POLICY "Users can update own profile safe fields"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role       = (SELECT role       FROM public.profiles WHERE id = auth.uid())
    AND company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid())
    AND user_type  = (SELECT user_type  FROM public.profiles WHERE id = auth.uid())
    AND is_team    = (SELECT is_team    FROM public.profiles WHERE id = auth.uid())
    AND is_admin   = (SELECT is_admin   FROM public.profiles WHERE id = auth.uid())
    AND team_role  = (SELECT team_role  FROM public.profiles WHERE id = auth.uid())
  );

-- ─── 2. The step catalogue ──────────────────────────────────────────────────
-- A closed, ordered set of steps, held as data so the vocabulary is defined
-- once. `mc_sub_stage` / `mc_active_status` are the whole reason this is a
-- table and not an enum in the edge function: they map a completed step onto
-- the exact strings ql-mc's kanban already renders
-- (20260518_mg_client_sub_stages.sql), so the two systems cannot drift into
-- describing the same client differently.
CREATE TABLE IF NOT EXISTS public.fulfilment_step_defs (
  step_key         text PRIMARY KEY,
  label            text NOT NULL,
  phase            text NOT NULL DEFAULT 'onboarding'
                     CHECK (phase IN ('onboarding','live')),
  sort_order       int  NOT NULL DEFAULT 0,
  -- Who is expected to do it. Advisory: it drives the "waiting on the client"
  -- grouping in the panel, it does not gate anything.
  owner_role       text NOT NULL DEFAULT 'team'
                     CHECK (owner_role IN ('team','client','ops')),
  -- Non-required steps can be left undone without the client counting as
  -- stuck, and are excluded from the progress denominator.
  required         boolean NOT NULL DEFAULT true,
  -- How long this step should take once the one before it landed. Feeds the
  -- overdue flag in the panel and the stuck list in ql-mc.
  sla_hours        int,
  mc_sub_stage     text,
  mc_active_status text,
  active           boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE  public.fulfilment_step_defs                  IS 'Ordered catalogue of fulfilment steps. Widen by inserting a row, never by adding another boolean to companies.';
COMMENT ON COLUMN public.fulfilment_step_defs.mc_sub_stage     IS 'The clients.onboarding_sub_stage value in ql-mc that this step means we have reached. NULL = this step does not move the kanban.';
COMMENT ON COLUMN public.fulfilment_step_defs.mc_active_status IS 'The clients.active_status value in ql-mc this step implies (only ads_live sets one today).';

INSERT INTO public.fulfilment_step_defs
  (step_key, label, phase, sort_order, owner_role, required, sla_hours, mc_sub_stage, mc_active_status) VALUES
  ('paid_signed',       'Paid & signed',                  'onboarding', 10, 'ops',    true,  NULL, 'Paid & Signed',                      NULL),
  ('intro_email_sent',  'Intro email sent',               'onboarding', 20, 'team',   true,  24,   'Paid & Signed',                      NULL),
  ('form_filled',       'Onboarding form completed',      'onboarding', 30, 'client', true,  72,   'Form Filled',                        NULL),
  ('ad_access_granted', 'Meta/Google access granted',     'onboarding', 40, 'client', true,  72,   'Meta/Google Access Granted',         NULL),
  ('assets_provided',   'Assets & testimonials received', 'onboarding', 50, 'client', true,  72,   'Assets Provided & Previews Pending', NULL),
  ('previews_sent',     'Previews sent to client',        'onboarding', 60, 'team',   true,  48,   'Assets Provided & Previews Pending', NULL),
  ('previews_accepted', 'Previews accepted',              'onboarding', 70, 'client', true,  72,   'Previews Accepted',                  NULL),
  ('page_live',         'Landing page live',              'onboarding', 80, 'team',   true,  48,   'Previews Accepted',                  NULL),
  ('sms_agent_live',    'SMS agent configured',           'onboarding', 90, 'team',   false, 48,   'Previews Accepted',                  NULL),
  ('campaign_built',    'Campaign built',                 'onboarding',100, 'team',   true,  48,   'Previews Accepted',                  NULL),
  ('ads_live',          'Ads live',                       'onboarding',110, 'team',   true,  24,   NULL,                                 'Ads Live'),
  ('first_lead',        'First lead delivered',           'live',      120, 'team',   false, 72,   NULL,                                 'Ads Live'),
  ('review_system_live','Review requests switched on',    'live',      130, 'team',   false, NULL, NULL,                                 NULL)
ON CONFLICT (step_key) DO UPDATE
  SET label            = EXCLUDED.label,
      phase            = EXCLUDED.phase,
      sort_order       = EXCLUDED.sort_order,
      owner_role       = EXCLUDED.owner_role,
      required         = EXCLUDED.required,
      sla_hours        = EXCLUDED.sla_hours,
      mc_sub_stage     = EXCLUDED.mc_sub_stage,
      mc_active_status = EXCLUDED.mc_active_status;

-- ─── 3. Per-client step state ───────────────────────────────────────────────
-- One row per client per step they have been moved off 'pending'. Absent means
-- pending, so a new step in the catalogue applies to every existing client
-- without a backfill.
CREATE TABLE IF NOT EXISTS public.company_fulfilment (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  step_key          text NOT NULL REFERENCES public.fulfilment_step_defs(step_key),
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','in_progress','blocked','done','skipped')),
  -- Set when status became done/skipped, cleared if it is reopened.
  completed_at      timestamptz,
  completed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Denormalised on purpose: the record has to stay readable after the person
  -- leaves and their auth row goes. Same reason client_email_log keeps
  -- sent_by_name alongside sent_by.
  completed_by_name text,
  -- Why it is blocked, or what was waived when it was skipped.
  notes             text,
  started_at        timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, step_key)
);

CREATE INDEX IF NOT EXISTS company_fulfilment_company_idx ON public.company_fulfilment (company_id);
CREATE INDEX IF NOT EXISTS company_fulfilment_status_idx  ON public.company_fulfilment (status);

-- ─── 4. The log ─────────────────────────────────────────────────────────────
-- Append-only record of what the Internal Team did to a client, and who did
-- it. Generalises client_email_log's shape to every mutating action in the
-- panel rather than just the intro email.
CREATE TABLE IF NOT EXISTS public.fulfilment_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id    uuid,
  actor_name  text,
  -- Dotted, past tense: fulfilment.step_set, note.added, preview.added,
  -- invoice.created, client.assigned, intro_email.sent.
  action      text NOT NULL,
  step_key    text,
  from_status text,
  to_status   text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fulfilment_log_company_idx ON public.fulfilment_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fulfilment_log_actor_idx   ON public.fulfilment_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fulfilment_log_action_idx  ON public.fulfilment_log (action);

COMMENT ON TABLE public.fulfilment_log IS
  'Append-only internal audit trail of Internal Team actions on a client. Never visible to the client - that is why it is not activity_log.';

-- ─── 5. The derived summary ql-mc reads ─────────────────────────────────────
-- Its own table rather than columns on `companies`, for two reasons: a company
-- row is readable by its own members, so a column there would have leaked the
-- pipeline into the client dashboard; and keeping it separate means this
-- feature adds nothing to a client-facing table at all.
--
-- ql-mc should not have to replay the log to draw a kanban card, and must
-- never hold the audit trail. It gets these columns mirrored onto its own
-- `clients` row instead.
CREATE TABLE IF NOT EXISTS public.company_fulfilment_summary (
  company_id     uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  -- The ql-mc vocabulary, derived. Do not edit by hand: recalc overwrites it.
  stage          text,
  stage_at       timestamptz,
  active_status  text,
  -- steps_done is strictly 'done'. steps_settled also counts 'skipped', and is
  -- the progress numerator: skipping a step is still progress past it, and a
  -- live client backfilled with skipped steps must not read as 3/10.
  steps_done     int NOT NULL DEFAULT 0,
  steps_settled  int NOT NULL DEFAULT 0,
  steps_total    int NOT NULL DEFAULT 0,
  blocked_count  int NOT NULL DEFAULT 0,
  -- The step the client is actually waiting on: first required step not yet
  -- settled. NULL once onboarding is complete.
  next_step_key  text,
  next_step_due  timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_fulfilment_summary_stage_idx ON public.company_fulfilment_summary (stage);
CREATE INDEX IF NOT EXISTS company_fulfilment_summary_due_idx   ON public.company_fulfilment_summary (next_step_due);

COMMENT ON TABLE public.company_fulfilment_summary IS
  'Derived roll-up of company_fulfilment, mirrored to ql-mc clients. Separate from companies so no client-facing row carries fulfilment state.';

-- Recompute one company's summary. The furthest SETTLED step (done or skipped)
-- names the stage: skipping a step still means you are past it.
CREATE OR REPLACE FUNCTION public.recalc_company_fulfilment(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage      text;
  v_stage_at   timestamptz;
  v_active     text;
  v_done       int;
  v_settled    int;
  v_total      int;
  v_blocked    int;
  v_next_key   text;
  v_next_sla   int;
  v_next_from  timestamptz;
BEGIN
  SELECT d.mc_sub_stage, cf.completed_at
    INTO v_stage, v_stage_at
    FROM public.company_fulfilment cf
    JOIN public.fulfilment_step_defs d ON d.step_key = cf.step_key
   WHERE cf.company_id = p_company_id
     AND cf.status IN ('done','skipped')
     AND d.active
     AND d.mc_sub_stage IS NOT NULL
   ORDER BY d.sort_order DESC
   LIMIT 1;

  SELECT d.mc_active_status
    INTO v_active
    FROM public.company_fulfilment cf
    JOIN public.fulfilment_step_defs d ON d.step_key = cf.step_key
   WHERE cf.company_id = p_company_id
     AND cf.status = 'done'
     AND d.active
     AND d.mc_active_status IS NOT NULL
   ORDER BY d.sort_order DESC
   LIMIT 1;

  SELECT count(*) INTO v_done
    FROM public.company_fulfilment cf
    JOIN public.fulfilment_step_defs d ON d.step_key = cf.step_key
   WHERE cf.company_id = p_company_id AND cf.status = 'done' AND d.active AND d.required;

  SELECT count(*) INTO v_settled
    FROM public.company_fulfilment cf
    JOIN public.fulfilment_step_defs d ON d.step_key = cf.step_key
   WHERE cf.company_id = p_company_id AND cf.status IN ('done','skipped') AND d.active AND d.required;

  SELECT count(*) INTO v_total
    FROM public.fulfilment_step_defs d
   WHERE d.active AND d.required;

  SELECT count(*) INTO v_blocked
    FROM public.company_fulfilment cf
    JOIN public.fulfilment_step_defs d ON d.step_key = cf.step_key
   WHERE cf.company_id = p_company_id AND cf.status = 'blocked' AND d.active;

  -- Next required step still outstanding, and when it falls due: its SLA runs
  -- from whenever the previous step landed, or from signup if none has.
  SELECT d.step_key, d.sla_hours
    INTO v_next_key, v_next_sla
    FROM public.fulfilment_step_defs d
    LEFT JOIN public.company_fulfilment cf
           ON cf.step_key = d.step_key AND cf.company_id = p_company_id
   WHERE d.active AND d.required
     AND coalesce(cf.status, 'pending') NOT IN ('done','skipped')
   ORDER BY d.sort_order
   LIMIT 1;

  IF v_next_key IS NOT NULL THEN
    SELECT coalesce(max(cf.completed_at), (SELECT c.created_at FROM public.companies c WHERE c.id = p_company_id))
      INTO v_next_from
      FROM public.company_fulfilment cf
     WHERE cf.company_id = p_company_id AND cf.status IN ('done','skipped');
  END IF;

  INSERT INTO public.company_fulfilment_summary
    (company_id, stage, stage_at, active_status, steps_done, steps_settled, steps_total,
     blocked_count, next_step_key, next_step_due, updated_at)
  VALUES
    (p_company_id, v_stage, v_stage_at, v_active, coalesce(v_done,0), coalesce(v_settled,0),
     coalesce(v_total,0), coalesce(v_blocked,0), v_next_key,
     CASE WHEN v_next_key IS NOT NULL AND v_next_sla IS NOT NULL
          THEN v_next_from + make_interval(hours => v_next_sla) END,
     now())
  ON CONFLICT (company_id) DO UPDATE
    SET stage         = EXCLUDED.stage,
        stage_at      = EXCLUDED.stage_at,
        active_status = EXCLUDED.active_status,
        steps_done    = EXCLUDED.steps_done,
        steps_settled = EXCLUDED.steps_settled,
        steps_total   = EXCLUDED.steps_total,
        blocked_count = EXCLUDED.blocked_count,
        next_step_key = EXCLUDED.next_step_key,
        next_step_due = EXCLUDED.next_step_due,
        updated_at    = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.company_fulfilment_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();

  -- completed_at follows status rather than being passed in, so a reopened
  -- step cannot keep a stale completion date.
  IF NEW.status IN ('done','skipped') THEN
    IF NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;

  IF NEW.status <> 'pending' AND NEW.started_at IS NULL THEN
    NEW.started_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_fulfilment_touch_trg ON public.company_fulfilment;
CREATE TRIGGER company_fulfilment_touch_trg
  BEFORE INSERT OR UPDATE ON public.company_fulfilment
  FOR EACH ROW EXECUTE FUNCTION public.company_fulfilment_touch();

CREATE OR REPLACE FUNCTION public.company_fulfilment_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalc_company_fulfilment(coalesce(NEW.company_id, OLD.company_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS company_fulfilment_recalc_trg ON public.company_fulfilment;
CREATE TRIGGER company_fulfilment_recalc_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.company_fulfilment
  FOR EACH ROW EXECUTE FUNCTION public.company_fulfilment_recalc();

-- ─── 6. Backfill ────────────────────────────────────────────────────────────
-- The point of the backfill is that nobody opens this panel to a wall of
-- clients falsely reported as stuck at step one. Every existing client is by
-- definition past the steps their current state implies, so we record that,
-- and we are explicit about which rows are inference rather than observation:
-- anything we did not watch happen is 'skipped', not 'done', with the reason
-- on the row. 'done' is reserved for what we actually have evidence of.

-- 6a. Anyone already on the books has paid and signed - that is what being a
--     company row means. Dated from signup, which is the closest thing we have.
INSERT INTO public.company_fulfilment (company_id, step_key, status, completed_at, completed_by_name, notes)
SELECT c.id, 'paid_signed', 'done', c.created_at, 'migrated',
       'Backfilled from the company record at signup'
  FROM public.companies c
ON CONFLICT (company_id, step_key) DO NOTHING;

-- 6b. companies.intro_email_sent was the one-boolean-per-step version of this
--     table. Real evidence with a real timestamp, so it lands as 'done'. The
--     column stays: 20260705000014 and the billing panel still read it, and
--     team-api now maintains both together.
INSERT INTO public.company_fulfilment (company_id, step_key, status, completed_at, completed_by_name, notes)
SELECT c.id, 'intro_email_sent', 'done', coalesce(c.intro_email_sent_at, now()), 'migrated',
       'Carried over from companies.intro_email_sent'
  FROM public.companies c
 WHERE c.intro_email_sent IS TRUE
ON CONFLICT (company_id, step_key) DO NOTHING;

-- 6c. A known ads-live date is evidence for that step.
INSERT INTO public.company_fulfilment (company_id, step_key, status, completed_at, completed_by_name, notes)
SELECT c.id, 'ads_live', 'done', c.ads_live_date::timestamptz, 'migrated',
       'Carried over from companies.ads_live_date'
  FROM public.companies c
 WHERE c.ads_live_date IS NOT NULL
ON CONFLICT (company_id, step_key) DO NOTHING;

-- 6d. The important one. If a client's ads are live, every onboarding step in
--     front of that plainly happened - you cannot run ads without the access,
--     the assets and an approved campaign. Left pending, those steps would
--     make a client of six months read as stuck at step one and would put
--     every existing client on ql-mc's overdue list the moment this ships.
--     They go in as 'skipped' rather than 'done' because we are inferring,
--     not attesting: settled enough to advance the stage and clear the stuck
--     list, still visibly distinct from a step someone actually ticked.
INSERT INTO public.company_fulfilment (company_id, step_key, status, completed_at, completed_by_name, notes)
SELECT c.id, d.step_key, 'skipped',
       coalesce(c.ads_live_date::timestamptz, c.created_at), 'migrated',
       'Pre-dates fulfilment tracking; inferred from ads being live'
  FROM public.companies c
  CROSS JOIN public.fulfilment_step_defs d
 WHERE c.ads_live_date IS NOT NULL
   AND d.phase = 'onboarding'
   AND d.sort_order < (SELECT sort_order FROM public.fulfilment_step_defs WHERE step_key = 'ads_live')
ON CONFLICT (company_id, step_key) DO NOTHING;

-- ─── 7. Actor on the existing note table ────────────────────────────────────
-- client_notes already records author_id/author_name. Nothing to add here; the
-- gap was in ql-mc's client_action_log, fixed on that side.

-- ─── 8. Hard lock ───────────────────────────────────────────────────────────
-- See the header. RLS on and FORCED with no policy, and every privilege
-- revoked from the roles a browser can ever authenticate as. Supabase grants
-- anon/authenticated broad table privileges by default, so the REVOKEs are
-- what make this hold even if someone later adds a policy by mistake: with no
-- GRANT there is nothing for a policy to permit.
--
-- FORCE is what stops the table owner (the role migrations run as) from
-- bypassing RLS, so a future SECURITY DEFINER function owned by that role
-- cannot read these tables out on a client's behalf either.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- new in this migration
    'fulfilment_step_defs', 'company_fulfilment', 'company_fulfilment_summary', 'fulfilment_log',
    -- the same class of internal-only data, until now relying on RLS alone
    'team_assignments', 'client_notes', 'client_email_log', 'team_availability'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
      -- service_role keeps its grant: team-api is the only way in, and it
      -- bypasses RLS by design.
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    END IF;
  END LOOP;
END $$;

-- The recalc function is SECURITY DEFINER, which in Supabase means PostgREST
-- would happily expose it as an RPC to any signed-in user. It takes a
-- company_id, so leaving it callable would let one client churn another's
-- summary. Only the service role needs it.
REVOKE ALL ON FUNCTION public.recalc_company_fulfilment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalc_company_fulfilment(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.recalc_company_fulfilment(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_company_fulfilment(uuid) TO service_role;

-- The trigger functions need no grants at all - a trigger fires as the table
-- owner regardless - so they are revoked outright rather than exposed.
REVOKE ALL ON FUNCTION public.company_fulfilment_touch()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.company_fulfilment_recalc() FROM PUBLIC, anon, authenticated;

-- ─── 9. Prime the summaries ─────────────────────────────────────────────────
-- So every existing company starts with a correct roll-up rather than a zeroed
-- one, and the stuck list in ql-mc is meaningful on day one.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.companies LOOP
    PERFORM public.recalc_company_fulfilment(r.id);
  END LOOP;
END $$;
