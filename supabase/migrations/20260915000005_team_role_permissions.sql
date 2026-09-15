-- ════════════════════════════════════════════════════════════════════════════
-- Editable permissions per Internal Team role
--
-- Until now the tiers were hardcoded: ops_manager meant "sees everything", every
-- other role meant "sees their assignments", and fulfilment was open to anyone on
-- the team. That last one is wrong - a CSM has no business in the fulfilment
-- checklist - and more importantly it could only be changed by editing and
-- redeploying an edge function, which is not where a permissions decision
-- belongs.
--
-- So capabilities become data: one row per role, one boolean per capability,
-- edited in /admin and enforced in team-api. Adding a role is an INSERT; changing
-- what a role may do is a checkbox.
--
-- WHAT THIS IS NOT
--   Not per-user permissions. A person's capabilities come from their role, so
--   there is one place to look when asking "what can a CSM do", rather than
--   twelve people configured twelve ways. Someone who needs different access gets
--   a different role.
--
--   Not a way to widen scope past assignment. all_clients decides whether a role
--   sees every client or only the ones assigned to them; nothing here lets a role
--   read a client it is not entitled to by some other route.
--
--   Not applicable to admins. is_admin is not a team role and is never limited by
--   this table - team-api treats an admin as fully capable, as it did before.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.team_role_permissions (
  role text PRIMARY KEY
         CHECK (role IN ('csm','ops_manager','media_buyer','tech_lead')),

  -- SCOPE. false = only the clients assigned to them. This is the one that used
  -- to be "is the role literally called ops_manager".
  all_clients        boolean NOT NULL DEFAULT false,

  -- FULFILMENT. view gates the whole section, the board and the per-client
  -- checklist; edit gates moving a step. edit without view is meaningless, and
  -- team-api treats it that way rather than trusting the pair to be sane.
  fulfilment_view    boolean NOT NULL DEFAULT false,
  fulfilment_edit    boolean NOT NULL DEFAULT false,

  -- The expensive buttons: ad copy via Claude, creatives via htmlcsstoimage.
  automations_run    boolean NOT NULL DEFAULT false,

  -- Emails that reach the client.
  intro_email_send   boolean NOT NULL DEFAULT false,
  preview_email_send boolean NOT NULL DEFAULT false,

  invoices_manage    boolean NOT NULL DEFAULT false,

  -- Releasing a held signup creates an account and emails a real person, so this
  -- stays narrow by default.
  signups_review     boolean NOT NULL DEFAULT false,

  -- Moving a client between team members.
  assignments_manage boolean NOT NULL DEFAULT false,

  updated_at timestamptz,
  updated_by uuid
);

COMMENT ON TABLE public.team_role_permissions IS
  'What each Internal Team role may do. Edited in /admin, enforced in team-api. Admins are never limited by this table.';
COMMENT ON COLUMN public.team_role_permissions.all_clients IS
  'false = assigned clients only. Replaces the hardcoded "ops_manager sees everything".';
COMMENT ON COLUMN public.team_role_permissions.fulfilment_view IS
  'Gates the Fulfilment tab, the board and the per-client checklist. A CSM defaults to false.';

-- Defaults chosen from what each role actually does day to day, not from a
-- hierarchy. A CSM owns the client relationship: intros, invoices, previews. A
-- media buyer and a tech lead build the thing: fulfilment and the automations. An
-- ops manager runs the floor: everything, every client.
INSERT INTO public.team_role_permissions
  (role, all_clients, fulfilment_view, fulfilment_edit, automations_run,
   intro_email_send, preview_email_send, invoices_manage, signups_review, assignments_manage) VALUES
  ('csm',          false, false, false, false, true,  true,  true,  false, false),
  ('ops_manager',  true,  true,  true,  true,  true,  true,  true,  true,  true ),
  ('media_buyer',  false, true,  true,  true,  false, true,  false, false, false),
  ('tech_lead',    false, true,  true,  true,  false, false, false, false, false)
ON CONFLICT (role) DO NOTHING;   -- never stomp on choices already made in /admin

-- Same lock as every other internal table: RLS forced with no policy, privileges
-- revoked from the roles a browser authenticates as. Read and written only by
-- team-api under the service role, which is also what enforces it - a permission
-- table a client could read would at least leak the shape of the team, and one it
-- could write would be no permission at all.
ALTER TABLE public.team_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_role_permissions FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_role_permissions FROM PUBLIC;
REVOKE ALL ON TABLE public.team_role_permissions FROM anon;
REVOKE ALL ON TABLE public.team_role_permissions FROM authenticated;
GRANT ALL ON TABLE public.team_role_permissions TO service_role;
