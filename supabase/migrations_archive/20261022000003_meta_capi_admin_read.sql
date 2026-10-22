-- The Client Pixels panel in /admin shows each managed client's sales sent to
-- Meta, so super-admins read every company's meta_capi_events.
create policy "Admins can view all meta events" on public.meta_capi_events
  for select using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));
