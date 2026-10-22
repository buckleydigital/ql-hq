-- =============================================================================
-- Phase 2: client uploads and the one-click preview pack
-- =============================================================================
-- Clients now add their own logo and photos from the dashboard (client-assets),
-- into the same library the creative studio reads. The team needs to tell the
-- two apart, and a client may only remove what they uploaded themselves.
--
-- The pack also runs an ad-rules check over every line of copy; its result is
-- kept on the company so the studio can show it after a reload.
-- =============================================================================

alter table public.company_assets
  add column if not exists source text not null default 'team'
  check (source in ('team', 'client'));

-- What the client told us alongside their uploads: reviews, testimonials, the
-- jobs they're proudest of. Kept apart from dfy_profile, which the onboarding
-- form rewrites whole when it is submitted again.
alter table public.companies add column if not exists client_testimonials text;

-- The last ad-rules check: what was flagged, what was rewritten, what still
-- needs a person.
alter table public.companies add column if not exists ad_policy_check jsonb;
