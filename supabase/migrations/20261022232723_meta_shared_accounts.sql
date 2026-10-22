-- Every ad account shared with the QuoteLeads Business Manager, as the access
-- watch has seen them, so it can tell the team about one nobody has claimed.
-- Clients no longer give their ad account ID on the onboarding form: a newly
-- shared account is emailed to the team, who say whose it is with one click.
--
--   baseline            already shared when this started; never emailed
--   notified_at         when the team was emailed about it
--   claimed_company_id  the client it was linked to
--   ignored             the team said it isn't a waiting client's
create table public.meta_shared_accounts (
  account_id text primary key,
  name text,
  business_name text,
  first_seen_at timestamptz not null default now(),
  baseline boolean not null default false,
  notified_at timestamptz,
  claimed_company_id uuid references public.companies(id) on delete set null,
  ignored boolean not null default false
);
alter table public.meta_shared_accounts enable row level security;
revoke all on table public.meta_shared_accounts from anon, authenticated;
