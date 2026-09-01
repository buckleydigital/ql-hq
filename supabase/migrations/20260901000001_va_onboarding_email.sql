-- ════════════════════════════════════════════════════════════════════════════
-- VA onboarding / intro email
--
-- Until now a VA copied a template out of the dashboard, pasted it into their
-- own mail client, sent it, then came back and ticked "intro email sent". The
-- tick was the only record, and it was on trust.
--
-- This makes the send happen in the dashboard: the VA opens the draft against
-- the client it is for, edits if they want, sends. companies.va_intro_done is
-- then set by the same code that got a 2xx from Resend, so the tick means the
-- email actually left.
--
--   1. email_templates.slug     - marks the one canonical intro template
--   2. profiles.va_reply_to_email - replies go to the VA who introduced himself
--   3. client_email_log          - what was sent, to whom, by whom
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. A stable handle on the intro template ────────────────────────────────
-- The free-form template list stays exactly as it is; one row is simply
-- nominated as the one the Send intro email button uses.
ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS email_templates_slug_key
  ON public.email_templates (slug) WHERE slug IS NOT NULL;

COMMENT ON COLUMN public.email_templates.slug IS
  'Nominates a template for a specific flow. onboarding_intro = the VA intro email.';

INSERT INTO public.email_templates (name, slug, subject, body)
SELECT
  'Onboarding / intro (VA)',
  'onboarding_intro',
  'Welcome to QuoteLeads, {company_name}',
  E'Hi {first_name},\n\nI am {va_name}, your account manager at QuoteLeads. I will be your point of contact from here on - anything you need, reply straight to this email and it comes to me.\n\nYour account is set up and I have gone over the scope of what we are building for {company_name}. Here is what happens next:\n\n  1. Log in to your dashboard at https://quoteleadshq.com/dashboard\n  2. Finish the onboarding form so we have your service area, budget and the jobs you want\n  3. Grant access to your Meta ad account and Page - the dashboard walks you through it\n\nOnce that is done we build and launch within 24 to 48 hours, and you approve everything before a cent is spent.\n\nIf anything about the scope looks wrong, tell me now rather than later and I will get it corrected.\n\n{va_name}\nAccount Manager, QuoteLeads'
WHERE NOT EXISTS (SELECT 1 FROM public.email_templates WHERE slug = 'onboarding_intro');

-- ── 2. Per-VA reply-to ──────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS va_reply_to_email text;

COMMENT ON COLUMN public.profiles.va_reply_to_email IS
  'Reply-To on emails this VA sends. Falls back to their login email.';

-- ── 3. The log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_email_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  to_email    text NOT NULL,
  reply_to    text,
  subject     text NOT NULL,
  body        text NOT NULL,
  sent_by     uuid,
  sent_by_name text,
  provider_id text,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_email_log_company_idx
  ON public.client_email_log (company_id, sent_at DESC);

-- Same lockdown as va_assignments and client_notes: RLS on, no permissive
-- policy, reachable only through va-api under the service role.
ALTER TABLE public.client_email_log ENABLE ROW LEVEL SECURITY;
