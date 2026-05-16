-- =============================================================================
-- PPL Postcode Snapshot
-- =============================================================================
-- Adds a ppl_postcode_in_territory column to leads that is written once — at
-- the first time the lead is checked against the company's agreed postcode
-- list.  It is never overwritten, so even if the postcode is later edited or
-- cleared the recorded match result is preserved and used for dispute checks.
-- =============================================================================

alter table public.leads
  add column if not exists ppl_postcode_in_territory boolean;

comment on column public.leads.ppl_postcode_in_territory is
  'NULL = not yet evaluated. true = postcode was inside agreed territory at first check. false = outside or empty. Immutable once set — used to prevent postcode-deletion bypass in outside_agreed_criteria disputes.';
