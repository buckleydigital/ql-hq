-- Everything the QuoteLeads Business Manager can see in Meta: the ad accounts
-- and Pages clients have shared with us (or we own), and the pixels on each ad
-- account, refreshed by meta-inventory. company_id is the client it belongs
-- to: suggested by name, confirmed by the team (match_confirmed). A pixel's
-- owner_business_id is null when it isn't in any business portfolio, which is
-- when Meta won't issue it a Conversions API token.
create table if not exists public.meta_assets (
  kind               text not null check (kind in ('ad_account', 'page', 'pixel')),
  meta_id            text not null,
  name               text,
  business_id        text,
  business_name      text,
  owner_business_id  text,
  ad_account_id      text,
  details            jsonb not null default '{}'::jsonb,
  company_id         uuid references public.companies(id) on delete set null,
  match_confirmed    boolean not null default false,
  seen_at            timestamptz not null default now(),
  primary key (kind, meta_id)
);
create index if not exists meta_assets_company on public.meta_assets (company_id);
alter table public.meta_assets enable row level security;
create policy "Admins can view meta assets" on public.meta_assets
  for select using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
