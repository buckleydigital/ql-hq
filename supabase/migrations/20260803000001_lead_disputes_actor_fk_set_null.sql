-- =============================================================================
-- Fix: lead_disputes.raised_by / resolved_by block user deletion
-- =============================================================================
-- Both columns were created referencing auth.users(id) with no ON DELETE
-- clause, which defaults to Postgres NO ACTION - deleting a user who ever
-- raised or resolved a dispute fails with a foreign-key violation (surfaced
-- to admins as an opaque "Failed to delete user: {}" from the GoTrue admin
-- API). Every other actor-reference column in the schema (created_by,
-- assigned_to, closed_by, sender_id, author_id, ...) uses ON DELETE SET NULL
-- instead - these two were just missed. Bring them in line: the dispute
-- record and its resolution stay intact, only the attribution is cleared.
-- =============================================================================

do $$
declare
  v_constraint text;
begin
  select tc.constraint_name into v_constraint
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'lead_disputes'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'raised_by';
  if v_constraint is not null then
    execute format('alter table public.lead_disputes drop constraint %I', v_constraint);
  end if;
end $$;

do $$
declare
  v_constraint text;
begin
  select tc.constraint_name into v_constraint
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'lead_disputes'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'resolved_by';
  if v_constraint is not null then
    execute format('alter table public.lead_disputes drop constraint %I', v_constraint);
  end if;
end $$;

alter table public.lead_disputes
  add constraint lead_disputes_raised_by_fkey
    foreign key (raised_by) references auth.users(id) on delete set null,
  add constraint lead_disputes_resolved_by_fkey
    foreign key (resolved_by) references auth.users(id) on delete set null;
