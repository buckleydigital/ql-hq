-- =============================================================================
-- Upload ledger and nightly clean-up for client media in R2
-- =============================================================================
-- Every signed upload link we hand out is written here first, with the exact
-- size and type it was signed for. That lets the caps count uploads still in
-- flight, rate-limits how many links one client can ask for, and gives the
-- clean-up job a full list of files that were started but never finished: an
-- upload can only exist in R2 if it has a row here.
-- =============================================================================

create table if not exists public.media_uploads (
  key           text primary key,
  company_id    uuid references public.companies(id) on delete cascade, -- null = stock
  kind          text not null,
  bytes         bigint not null,
  content_type  text not null,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists media_uploads_company_idx on public.media_uploads (company_id, created_at);
create index if not exists media_uploads_open_idx on public.media_uploads (created_at) where finished_at is null;
alter table public.media_uploads enable row level security;
alter table public.media_uploads force row level security;
revoke all on table public.media_uploads from anon, authenticated;

-- The clean-up job's secret, generated here and kept only in the vault.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'media_cleanup_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'media_cleanup_secret');
  end if;
end $$;

create or replace function public.media_cleanup_secret_ok(p text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'media_cleanup_secret' and decrypted_secret = p
  )
$$;
revoke all on function public.media_cleanup_secret_ok(text) from public, anon, authenticated;
grant execute on function public.media_cleanup_secret_ok(text) to service_role;

select cron.schedule(
  'media-cleanup',
  '17 17 * * *', -- 3:17am Brisbane
  $$ select net.http_post(
       url     := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/media-cleanup',
       headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'media_cleanup_secret')),
       body    := '{}'::jsonb,
       timeout_milliseconds := 60000) $$
);
