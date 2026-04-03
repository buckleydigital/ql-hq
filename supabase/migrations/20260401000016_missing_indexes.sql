-- ═════════════════════════════════════════════════════════════════════════════
-- Migration 016 — Add missing indexes
-- ═════════════════════════════════════════════════════════════════════════════
-- Adds indexes on columns that are frequently queried but were missing.

create index if not exists idx_voice_calls_vapi_call
  on public.voice_calls (vapi_call_id);

create index if not exists idx_conversations_assigned
  on public.conversations (assigned_to);

create index if not exists idx_conversations_sms_config
  on public.conversations (sms_config_id);
