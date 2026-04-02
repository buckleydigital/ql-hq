-- =============================================================================
-- Ensure voice_agent_config has a UNIQUE constraint on company_id
-- =============================================================================
-- The dashboard JS uses .upsert(payload, { onConflict: "company_id" }) which
-- requires a unique or exclusion constraint on company_id.  Without it the
-- upsert fails with "there is no unique or exclusion constraint matching
-- the ON CONFLICT specification".
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'voice_agent_config_company_id_key'
  ) then
    alter table public.voice_agent_config
      add constraint voice_agent_config_company_id_key unique (company_id);
  end if;
end $$;
