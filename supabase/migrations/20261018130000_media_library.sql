-- =============================================================================
-- Client media and the stock library
-- =============================================================================
-- Clients upload photos and videos in onboarding, or choose our stock library
-- instead. Files the client uploads, and the stock library, live in a private
-- Cloudflare R2 bucket (see _shared/r2.ts): videos are far bigger than the
-- Supabase plan allows per file. Team uploads in the creative studio stay in
-- Supabase Storage as before.
-- =============================================================================

-- Stock photos and videos, tagged with the trades they suit. The team keeps
-- this library; a client who picks "use stock" gets the matching items.
create table if not exists public.stock_assets (
  id           uuid primary key default gen_random_uuid(),
  trades       text[] not null default '{}',
  kind         text not null check (kind in ('photo', 'video')),
  path         text not null unique,
  content_type text,
  width        int,
  height       int,
  bytes        bigint,
  label        text,
  active       boolean not null default true,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists stock_assets_trades_idx on public.stock_assets using gin (trades);
alter table public.stock_assets enable row level security;
alter table public.stock_assets force row level security;
revoke all on table public.stock_assets from anon, authenticated;

-- A client's library can now hold videos, files kept in R2, and stock items
-- picked for them (which point at the stock file rather than copying it).
alter table public.company_assets drop constraint if exists company_assets_kind_check;
alter table public.company_assets add constraint company_assets_kind_check
  check (kind in ('logo', 'photo', 'video'));
alter table public.company_assets drop constraint if exists company_assets_source_check;
alter table public.company_assets add constraint company_assets_source_check
  check (source in ('team', 'client', 'stock'));
alter table public.company_assets add column if not exists storage text not null default 'supabase'
  check (storage in ('supabase', 'r2'));
alter table public.company_assets add column if not exists content_type text;
alter table public.company_assets add column if not exists bytes bigint;
alter table public.company_assets add column if not exists stock_asset_id uuid
  references public.stock_assets(id) on delete cascade;
-- An R2 file has no permanent public URL; one is signed when it is read.
alter table public.company_assets alter column url drop not null;

-- The client's choice in onboarding: their own photos and videos, or ours.
alter table public.companies add column if not exists creative_source text
  check (creative_source in ('custom', 'stock'));
