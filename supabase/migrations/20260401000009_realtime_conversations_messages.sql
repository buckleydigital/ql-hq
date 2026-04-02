-- =============================================================================
-- Enable Supabase Realtime for conversations & messages
-- =============================================================================
-- Without this, the dashboard's postgres_changes subscription receives
-- nothing because the tables are not in the supabase_realtime publication.
--
-- REPLICA IDENTITY FULL is required so that UPDATE / DELETE payloads include
-- all columns (not just the PK), allowing client-side filters like
-- company_id matching to work on every event type.
-- =============================================================================

-- Add tables to the Realtime publication
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;

-- Full replica identity so payload.new and payload.old always carry all columns
alter table public.conversations replica identity full;
alter table public.messages      replica identity full;
