-- Test accounts: a company flagged is_test is a sandbox for walking the
-- fulfilment flow end to end. team-api shows it to admins only (an ops
-- manager's "every client" excludes it, and it cannot be assigned to a team
-- member), and its fulfilment summary is never mirrored to ql-mc, so testing
-- does not put a fake client on the real kanban.
alter table public.companies
  add column if not exists is_test boolean not null default false;

comment on column public.companies.is_test is
  'Sandbox account for testing fulfilment. Admin-only in the Team Panel; never mirrored to ql-mc.';
