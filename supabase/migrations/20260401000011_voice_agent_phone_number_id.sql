-- Add vapi_phone_number_id column to voice_agent_config.
-- VAPI's POST /call/phone endpoint requires either phoneNumberId or phoneNumber
-- to identify the outbound caller number registered in the VAPI account.

alter table public.voice_agent_config
  add column if not exists vapi_phone_number_id text;

comment on column public.voice_agent_config.vapi_phone_number_id
  is 'VAPI phone number ID — the registered outbound caller number in the VAPI account';
