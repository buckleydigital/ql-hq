-- =============================================================================
-- PPL Dispute Improvements
-- =============================================================================
-- 1. Action tracking on lead_disputes (credit_issued / replacement_sent)
-- 2. Atomic escalate_to_manual_review() to eliminate the race condition where
--    two concurrent requests could both pass the scrub-cap check and both
--    escalate to pending_manual_review.
-- =============================================================================

-- ─── Action tracking columns ──────────────────────────────────────────────────

alter table public.lead_disputes
  add column if not exists action_taken_at timestamptz,
  add column if not exists action_type     text check (action_type in ('credit_issued', 'replacement_sent')),
  add column if not exists action_taken_by uuid references auth.users(id);

-- ─── Atomic manual-review escalation ─────────────────────────────────────────
-- Locks the company row so that concurrent escalation requests are serialised.
-- The scrub-cap check and the status update happen in the same transaction.

create or replace function public.escalate_to_manual_review(
  p_dispute_id uuid,
  p_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispute   record;
  v_scrub     jsonb;
begin
  -- Serialise concurrent escalations for this company.
  perform id
  from public.companies
  where id = p_company_id
  for update;

  select id, company_id, reason, status
  into v_dispute
  from public.lead_disputes
  where id = p_dispute_id;

  if not found then
    return jsonb_build_object('error', 'Dispute not found', 'code', 404);
  end if;

  if v_dispute.company_id <> p_company_id then
    return jsonb_build_object('error', 'Forbidden', 'code', 403);
  end if;

  if v_dispute.reason <> 'outside_agreed_criteria' then
    return jsonb_build_object(
      'error', 'Only outside_agreed_criteria disputes can be sent for manual review',
      'code', 422
    );
  end if;

  if v_dispute.status not in ('auto_approved', 'auto_rejected') then
    return jsonb_build_object(
      'error', format('Dispute is already in status: %s', v_dispute.status),
      'code', 409
    );
  end if;

  -- Re-check scrub cap inside the lock so no two requests can both slip through.
  v_scrub := public.get_ppl_scrub_usage(p_company_id);

  if (v_scrub ->> 'cap_exceeded')::boolean then
    return jsonb_build_object(
      'error',        'Scrub cap exceeded',
      'code',         422,
      'cap_exceeded', true,
      'scrub_usage',  v_scrub
    );
  end if;

  update public.lead_disputes
  set
    status         = 'pending_manual_review',
    scrub_cap_pct  = (v_scrub ->> 'scrub_cap_pct')::numeric,
    scrub_used_pct = (v_scrub ->> 'scrub_used_pct')::numeric
  where id = p_dispute_id;

  return jsonb_build_object(
    'ok',          true,
    'dispute_id',  p_dispute_id,
    'scrub_usage', v_scrub
  );
end;
$$;

grant execute on function public.escalate_to_manual_review(uuid, uuid) to service_role;
