-- ============================================================================
-- Private storage for files attached to leads (e.g. electricity bills sent
-- through a client's funnel).
-- ============================================================================
-- Path convention: <company_id>/<lead_id>/<file>
-- Uploads happen ONLY through edge functions using the service role (which
-- bypasses storage RLS), so there is no insert policy: the anon key and
-- dashboard users cannot write here.
-- Reading: a signed-in user can open a file only if they can see the lead it
-- belongs to. The subquery on public.leads runs under the leads RLS policies,
-- so company scoping and rep "assigned only" visibility both carry over.
-- objects.name must be qualified: leads has its own `name` column, and a bare
-- `name` inside the subquery resolves to the lead's name, matching nothing.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lead-files',
  'lead-files',
  false,
  10485760,  -- 10 MB per file
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "lead files readable by those who can see the lead" on storage.objects;
create policy "lead files readable by those who can see the lead"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lead-files'
    and exists (
      select 1 from public.leads l
      where l.id::text = (storage.foldername(objects.name))[2]
        and l.company_id::text = (storage.foldername(objects.name))[1]
    )
  );
