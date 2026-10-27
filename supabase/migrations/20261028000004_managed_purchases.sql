-- A system bought on /buy-system, waiting for its onboarding form.
--
-- Paying no longer creates the QuoteLeadsHQ account: the onboarding form does,
-- as it does for everyone else. stripe-webhook records the purchase here, and
-- growth-onboarding claims it when the buyer submits the form (paying is what
-- clears the spam gate for them), which applies it to the new account: the
-- managed plan, the build fee, "Paid & signed", and the ql-mc client.
-- Pay-per-lead first orders still create the account at payment.
create table if not exists public.managed_purchases (
  stripe_session_id  text primary key,
  email              text not null,
  metadata           jsonb not null default '{}'::jsonb,
  stripe_customer_id text,
  paid_cents         integer,
  created_at         timestamptz not null default now(),
  company_id         uuid references public.companies(id) on delete set null,
  claimed_at         timestamptz,
  reminded_at        timestamptz
);
create index if not exists managed_purchases_email_idx on public.managed_purchases (lower(email));
alter table public.managed_purchases enable row level security;
revoke all on table public.managed_purchases from public, anon, authenticated;
