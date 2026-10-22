-- =============================================================================
-- Creative studio: each client's assets, brand colour and creative direction
-- =============================================================================
-- The team panel builds Meta and Google image ads from a client's own photos
-- and logo. fulfilment-ai writes the words (from an editable prompt) and keeps
-- the asset library; the panel draws the images and saves them as preview
-- links, the same as a hand-made Canva upload.
-- =============================================================================

-- A client's logo and photos. Files live in the public preview-images bucket
-- under <company_id>/assets/. Service role only, like preview_links: every
-- read and write goes through fulfilment-ai, which checks the caller.
create table if not exists public.company_assets (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  kind        text not null check (kind in ('logo', 'photo')),
  url         text not null,
  path        text not null,
  width       int,
  height      int,
  label       text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists company_assets_company_idx on public.company_assets (company_id, created_at);

alter table public.company_assets enable row level security;
revoke all on table public.company_assets from anon, authenticated;

-- Per client: the accent the creatives use, a note that steers the copy for
-- this client only, and the last copy written for the creatives.
alter table public.companies add column if not exists brand_color   text;
alter table public.companies add column if not exists creative_note text;
alter table public.companies add column if not exists creative_copy jsonb;

-- The house creative direction, editable by an admin. Null means the built-in
-- default in fulfilment-ai.
alter table public.platform_settings add column if not exists creative_prompt text;
