-- Baseline: the whole app schema as it stands in the live database, generated
-- from the catalog on 2026-10-22. It replaces the earlier migrations (kept in
-- supabase/migrations_archive for their notes), which never created the core
-- tables and couldn't rebuild the database. New changes go in new migrations
-- after this one.
--
-- Needs the Supabase platform schemas (auth, storage, vault, cron, net), and
-- these vault secrets, which aren't in the repo:
-- agency_openai_key, agency_twilio_auth, agency_twilio_sid,
-- app_encryption_key, autopilot_secret, media_cleanup_secret, meta_watch_secret
set check_function_bodies = off;
set search_path = public, extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ===== Types =====
create type public.api_key_provider as enum ('openai', 'twilio', 'twilio_auth', 'sendgrid', 'stripe', 'custom', 'vapi');
create type public.appointment_status as enum ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show');
create type public.appointment_type as enum ('callback', 'onsite', 'other');
create type public.call_direction as enum ('inbound', 'outbound');
create type public.call_outcome as enum ('no_answer', 'voicemail', 'connected', 'wrong_number', 'callback_requested');
create type public.call_status as enum ('ringing', 'in_progress', 'completed', 'missed', 'failed', 'voicemail');
create type public.conversation_channel as enum ('sms', 'email', 'webchat', 'whatsapp', 'phone', 'voice');
create type public.dispute_reason as enum ('invalid_number', 'duplicate', 'outside_agreed_criteria');
create type public.dispute_status as enum ('pending', 'auto_approved', 'auto_rejected', 'pending_manual_review', 'manual_approved', 'manual_rejected');
create type public.pipeline_stage as enum ('new_lead', 'qualifying', 'follow_up', 'quote_in_progress', 'quoted', 'closed_won', 'closed_lost');
create type public.quote_status as enum ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired');
create type public.rep_visibility as enum ('all', 'assigned_only', 'none');
create type public.sale_status as enum ('pending', 'processing', 'completed', 'refunded', 'cancelled');
create type public.user_type as enum ('internal', 'external');

-- ===== Sequences =====
create sequence if not exists public.invoice_number_seq as bigint increment 1 minvalue 1 maxvalue 9223372036854775807 start 1000;

-- ===== Tables =====
create table public.activity_log (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  user_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

alter table public.activity_log enable row level security;
create table public.agency_key_mappings (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  provider api_key_provider not null,
  vault_secret_id uuid not null,
  label text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.agency_key_mappings enable row level security;
create table public.ai_performance_stats (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  period text not null,
  period_start date not null,
  total_leads integer default 0 not null,
  ai_handled_leads integer default 0 not null,
  human_handled_leads integer default 0 not null,
  ai_conversions integer default 0 not null,
  human_conversions integer default 0 not null,
  ai_conversion_rate numeric(5,2) default 0,
  human_conversion_rate numeric(5,2) default 0,
  avg_ai_score numeric(5,2) default 0,
  avg_score_improvement numeric(5,2) default 0,
  callbacks_booked integer default 0 not null,
  onsites_booked integer default 0 not null,
  quotes_generated integer default 0 not null,
  voice_calls_completed integer default 0 not null,
  avg_call_sentiment numeric(3,2) default NULL::numeric,
  knowledge_items_count integer default 0 not null,
  computed_at timestamp with time zone default now() not null
);

alter table public.ai_performance_stats enable row level security;
create table public.ai_workflow_runs (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  lead_id uuid,
  conversation_id uuid,
  message_id uuid,
  workflow_type text default 'sms_inbound'::text not null,
  status text default 'pending'::text not null,
  model text,
  provider text,
  key_source text,
  input jsonb default '{}'::jsonb not null,
  output jsonb default '{}'::jsonb not null,
  error_text text,
  started_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

alter table public.ai_workflow_runs enable row level security;
create table public.api_keys (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  provider api_key_provider not null,
  label text,
  encrypted_key bytea not null,
  key_hint text,
  is_active boolean default true,
  created_by uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.api_keys enable row level security;
create table public.appointments (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  lead_id uuid,
  assigned_to uuid,
  title text not null,
  description text,
  status appointment_status default 'scheduled'::appointment_status,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone not null,
  location text,
  meeting_url text,
  notes text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  appointment_type appointment_type default 'other'::appointment_type,
  booked_by text default 'human'::text
);

alter table public.appointments enable row level security;
create table public.au_postcode_points (
  postcode text not null,
  state text not null,
  lat numeric(7,3) not null,
  lng numeric(7,3) not null
);

alter table public.au_postcode_points enable row level security;
create table public.business_settings (
  id integer default 1 not null,
  business_name text,
  abn text,
  bank_name text,
  account_name text,
  bsb text,
  account_number text,
  payment_details text,
  logo_url text,
  updated_at timestamp with time zone default now() not null
);

alter table public.business_settings enable row level security;
create table public.call_log (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  actor_id uuid,
  actor_name text,
  agent_number text not null,
  client_number text not null,
  client_label text,
  caller_id text not null,
  twilio_call_sid text,
  status text default 'queued'::text not null,
  duration_secs integer,
  error_code text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.call_log force row level security;
alter table public.call_log enable row level security;
create table public.campaign_builds (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  round_id uuid,
  status text default 'queued'::text not null,
  stage text default 'settings'::text not null,
  settings jsonb default '{}'::jsonb not null,
  meta jsonb default '{}'::jsonb not null,
  error text,
  attempts integer default 0 not null,
  started_by_name text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  built_at timestamp with time zone
);

alter table public.campaign_builds enable row level security;
create table public.client_email_log (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  kind text not null,
  to_email text not null,
  reply_to text,
  subject text not null,
  body text not null,
  sent_by uuid,
  sent_by_name text,
  provider_id text,
  sent_at timestamp with time zone default now() not null
);

alter table public.client_email_log force row level security;
alter table public.client_email_log enable row level security;
create table public.client_notes (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  author_id uuid,
  author_name text,
  body text not null,
  created_at timestamp with time zone default now() not null
);

alter table public.client_notes force row level security;
alter table public.client_notes enable row level security;
create table public.client_reminders (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  kind text not null,
  sent_at timestamp with time zone default now() not null,
  detail jsonb default '{}'::jsonb not null
);

alter table public.client_reminders force row level security;
alter table public.client_reminders enable row level security;
create table public.companies (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  domain text,
  logo_url text,
  plan text default 'free'::text,
  settings jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  email text,
  phone text,
  ppl_agreed_postcodes text[] default '{}'::text[] not null,
  ppl_scrub_cap_pct numeric(5,2) default 10 not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text default 'active'::text,
  website_url text,
  service_area text,
  testimonials jsonb,
  ppl_area_locked boolean default true not null,
  niche text,
  payment_method text,
  ads_live_date date,
  next_invoice_due date,
  invoice_status text default 'none'::text,
  intro_email_sent boolean default false not null,
  intro_email_sent_at timestamp with time zone,
  dfy_profile jsonb default '{}'::jsonb not null,
  management_status text,
  management_subscription_id text,
  management_period_end timestamp with time zone,
  management_cancel_at_end boolean default false not null,
  management_included_from date,
  onboarding_completed boolean default false,
  max_daily_ad_spend numeric(10,2),
  generated_ad_copy jsonb default '{}'::jsonb,
  management_fee_cents integer,
  brand_color text,
  creative_note text,
  creative_copy jsonb,
  client_testimonials text,
  ad_policy_check jsonb,
  creative_source text,
  approval_token text,
  campaign_settings jsonb default '{}'::jsonb not null,
  meta_dataset_id text,
  meta_dataset_connected text,
  meta_dataset_error text
);

alter table public.companies enable row level security;
create table public.company_api_tokens (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  token_hash text not null,
  token_prefix text not null,
  name text default 'Unnamed Key'::text not null,
  scopes jsonb default '["leads:read", "quotes:read", "appointments:read", "voice-calls:read", "pipeline:read"]'::jsonb not null,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone,
  revoked_at timestamp with time zone
);

alter table public.company_api_tokens enable row level security;
create table public.company_assets (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  kind text not null,
  url text,
  path text not null,
  width integer,
  height integer,
  label text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  source text default 'team'::text not null,
  storage text default 'supabase'::text not null,
  content_type text,
  bytes bigint,
  stock_asset_id uuid
);

alter table public.company_assets enable row level security;
create table public.company_capi_tokens (
  company_id uuid not null,
  secret_id uuid not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.company_capi_tokens enable row level security;
create table public.company_fulfilment (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  step_key text not null,
  status text default 'pending'::text not null,
  completed_at timestamp with time zone,
  completed_by uuid,
  completed_by_name text,
  notes text,
  started_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null
);

create table public.company_fulfilment_summary (
  company_id uuid not null,
  stage text,
  stage_at timestamp with time zone,
  active_status text,
  steps_done integer default 0 not null,
  steps_settled integer default 0 not null,
  steps_total integer default 0 not null,
  blocked_count integer default 0 not null,
  next_step_key text,
  next_step_due timestamp with time zone,
  updated_at timestamp with time zone default now() not null
);

alter table public.company_fulfilment_summary force row level security;
alter table public.company_fulfilment_summary enable row level security;
alter table public.company_fulfilment force row level security;
alter table public.company_fulfilment enable row level security;
create table public.company_knowledge (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  category text not null,
  insight text not null,
  tags text[] default '{}'::text[] not null,
  source_type text not null,
  source_lead_id uuid,
  times_used integer default 0 not null,
  effectiveness_score numeric(3,2) default NULL::numeric,
  metadata jsonb default '{}'::jsonb not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.company_knowledge enable row level security;
create table public.conversations (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  lead_id uuid,
  channel conversation_channel default 'sms'::conversation_channel,
  subject text,
  is_open boolean default true,
  last_message text,
  last_message_at timestamp with time zone,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  assigned_to uuid,
  sms_config_id uuid
);

alter table public.conversations replica identity full;
alter table public.conversations enable row level security;
create table public.creative_rounds (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  round integer not null,
  status text not null,
  build_stage text,
  ads jsonb default '[]'::jsonb not null,
  policy jsonb,
  changes jsonb,
  feedback jsonb,
  previews jsonb,
  reminders jsonb default '{}'::jsonb not null,
  error text,
  created_at timestamp with time zone default now() not null,
  sent_at timestamp with time zone,
  sent_by_name text,
  decided_at timestamp with time zone
);

alter table public.creative_rounds force row level security;
alter table public.creative_rounds enable row level security;
create table public.custom_fields (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  entity_type text default 'lead'::text not null,
  field_key text not null,
  label text not null,
  field_type text default 'text'::text not null,
  is_required boolean default false not null,
  is_active boolean default true not null,
  sort_order integer default 0 not null,
  settings jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.custom_fields enable row level security;
create table public.demo_requests (
  id uuid default gen_random_uuid() not null,
  name text not null,
  email text not null,
  phone text,
  company text,
  created_at timestamp with time zone default now()
);

alter table public.demo_requests enable row level security;
create table public.elevenlabs_voices (
  id uuid default gen_random_uuid() not null,
  name text not null,
  voice_id text not null,
  created_at timestamp with time zone default now()
);

alter table public.elevenlabs_voices enable row level security;
create table public.email_templates (
  id uuid default gen_random_uuid() not null,
  name text not null,
  subject text,
  body text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  slug text
);

alter table public.email_templates enable row level security;
create table public.fulfilment_log (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  actor_id uuid,
  actor_name text,
  action text not null,
  step_key text,
  from_status text,
  to_status text,
  detail jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

alter table public.fulfilment_log force row level security;
alter table public.fulfilment_log enable row level security;
create table public.fulfilment_step_defs (
  step_key text not null,
  label text not null,
  phase text default 'onboarding'::text not null,
  sort_order integer default 0 not null,
  owner_role text default 'team'::text not null,
  required boolean default true not null,
  sla_hours integer,
  mc_sub_stage text,
  mc_active_status text,
  active boolean default true not null,
  automation text
);

alter table public.fulfilment_step_defs force row level security;
alter table public.fulfilment_step_defs enable row level security;
create table public.industry_insights (
  id uuid default gen_random_uuid() not null,
  industry text not null,
  insight text not null,
  sample_size integer default 0 not null,
  confidence numeric(3,2) default 0 not null,
  tags text[] default '{}'::text[] not null,
  metadata jsonb default '{}'::jsonb not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.industry_insights enable row level security;
create table public.invoices (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  invoice_number text default ('INV-'::text || lpad((nextval('invoice_number_seq'::regclass))::text, 5, '0'::text)),
  client_name text,
  client_email text,
  offer_type text,
  vertical text,
  delivery_period_start date,
  delivery_period_end date,
  line_items jsonb default '[]'::jsonb not null,
  subtotal numeric(12,2) default 0 not null,
  gst_type text default 'exclusive'::text,
  gst_amount numeric(12,2) default 0 not null,
  total numeric(12,2) default 0 not null,
  payment_details text,
  notes text,
  status text default 'draft'::text not null,
  invoice_date date,
  due_date date,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.invoices enable row level security;
create table public.lead_custom_field_values (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  lead_id uuid not null,
  custom_field_id uuid not null,
  value_text text,
  value_number numeric,
  value_date date,
  value_boolean boolean,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.lead_custom_field_values enable row level security;
create table public.lead_disputes (
  id uuid default gen_random_uuid() not null,
  lead_id uuid not null,
  company_id uuid not null,
  raised_by uuid,
  reason dispute_reason not null,
  status dispute_status default 'pending'::dispute_status not null,
  auto_check_result jsonb default '{}'::jsonb not null,
  manual_review_notes text,
  scrub_cap_pct numeric(5,2),
  scrub_used_pct numeric(5,2),
  resolved_at timestamp with time zone,
  resolved_by uuid,
  resolution_notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.lead_disputes enable row level security;
create table public.lead_notification_log (
  id uuid default gen_random_uuid() not null,
  lead_id uuid not null,
  company_id uuid,
  profile_id uuid not null,
  channel text not null,
  destination text,
  status text default 'sending'::text not null,
  response_code integer,
  response_body text,
  created_at timestamp with time zone default now() not null
);

alter table public.lead_notification_log enable row level security;
create table public.leads (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  assigned_to uuid,
  first_name text not null,
  last_name text,
  email text,
  phone text,
  source text,
  service_type text,
  value numeric(12,2) default 0,
  notes text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  pipeline_stage pipeline_stage default 'new_lead'::pipeline_stage,
  pipeline_position integer default 0,
  postcode text,
  address text,
  lead_score integer default 0 not null,
  qualification_status text,
  ai_enabled boolean default true not null,
  last_inbound_at timestamp with time zone,
  last_outbound_at timestamp with time zone,
  ai_score integer default 0,
  ai_score_reason text,
  custom_data jsonb default '{}'::jsonb,
  name text,
  status text default 'New Lead'::text,
  ai_summary text,
  ai_status text default 'new'::text,
  is_ppl boolean default false not null,
  company text,
  sms_opted_out boolean default false not null,
  sms_opted_out_at timestamp with time zone,
  ppl_scrubbed boolean default false not null
);

alter table public.leads enable row level security;
create table public.media_uploads (
  key text not null,
  company_id uuid,
  kind text not null,
  bytes bigint not null,
  content_type text not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone
);

alter table public.media_uploads force row level security;
alter table public.media_uploads enable row level security;
create table public.messages (
  id uuid default gen_random_uuid() not null,
  conversation_id uuid not null,
  sender_id uuid,
  direction text not null,
  body text not null,
  channel conversation_channel,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  is_ai_generated boolean default false,
  agent_type text
);

alter table public.messages replica identity full;
alter table public.messages enable row level security;
create table public.meta_assets (
  kind text not null,
  meta_id text not null,
  name text,
  business_id text,
  business_name text,
  owner_business_id text,
  ad_account_id text,
  details jsonb default '{}'::jsonb not null,
  company_id uuid,
  match_confirmed boolean default false not null,
  seen_at timestamp with time zone default now() not null
);

alter table public.meta_assets enable row level security;
create table public.meta_capi_events (
  lead_id uuid not null,
  company_id uuid not null,
  dataset_id text not null,
  event_name text default 'Purchase'::text not null,
  value numeric(12,2),
  matched_by text[] default '{}'::text[] not null,
  sent_at timestamp with time zone,
  error text,
  attempts integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

alter table public.meta_capi_events enable row level security;
create table public.meta_connections (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  user_id uuid not null,
  access_token text not null,
  token_expires_at timestamp with time zone,
  business_manager_id text,
  ad_account_id text,
  ad_account_name text,
  status text default 'connected'::text,
  connected_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.meta_connections enable row level security;
create table public.meta_leads (
  leadgen_id text not null,
  company_id uuid not null,
  build_id uuid,
  form_id text not null,
  ad_id text,
  fields jsonb default '{}'::jsonb not null,
  lead_id uuid,
  error text,
  attempts integer default 0 not null,
  meta_created_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  page_id text,
  delivery text default 'make'::text not null
);

alter table public.meta_leads enable row level security;
create table public.niche_benchmarks (
  niche text not null,
  company_count integer default 0 not null,
  avg_ai_coverage numeric(5,2),
  avg_callback_rate numeric(5,2),
  p25_callback_rate numeric(5,2),
  p75_callback_rate numeric(5,2),
  avg_win_rate numeric(5,2),
  p25_win_rate numeric(5,2),
  p75_win_rate numeric(5,2),
  avg_lead_score numeric(5,1),
  avg_deal_value numeric(10,2),
  updated_at timestamp with time zone default now(),
  ai_leads_analysed integer default 0 not null,
  avg_reply_rate numeric(5,2),
  p25_reply_rate numeric(5,2),
  p75_reply_rate numeric(5,2)
);

alter table public.niche_benchmarks enable row level security;
create table public.notifications (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  lead_id uuid,
  type text not null,
  title text not null,
  message text,
  is_read boolean default false,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

alter table public.notifications replica identity full;
alter table public.notifications enable row level security;
create table public.onboarding_submissions (
  id uuid default gen_random_uuid() not null,
  payload jsonb default '{}'::jsonb not null,
  first_name text,
  last_name text,
  email text,
  phone text,
  phone_e164 text,
  company text,
  industry text,
  service_location text,
  service_radius text,
  max_daily_spend text,
  gate_status text default 'pending'::text not null,
  gate_checked_at timestamp with time zone,
  gate_detail jsonb default '{}'::jsonb not null,
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamp with time zone,
  review_notes text,
  company_id uuid,
  account_created_at timestamp with time zone,
  welcome_email_sent_at timestamp with time zone,
  last_error text,
  error_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.onboarding_submissions force row level security;
alter table public.onboarding_submissions enable row level security;
create table public.password_reset_tokens (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  token_hash text not null,
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

alter table public.password_reset_tokens enable row level security;
create table public.pending_magic_links (
  stripe_session_id text not null,
  magic_link text not null,
  created_at timestamp with time zone default now(),
  expires_at timestamp with time zone default (now() + '01:00:00'::interval)
);

alter table public.pending_magic_links enable row level security;
create table public.platform_settings (
  id smallint default 1 not null,
  shared_ppl_twilio_number text default '+61485016260'::text not null,
  updated_at timestamp with time zone default now(),
  outbound_caller_id text,
  team_sms_number text,
  creative_prompt text,
  ppl_orders_paused boolean default false not null
);

alter table public.platform_settings enable row level security;
create table public.ppl_area_change_requests (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  message text,
  status text default 'pending'::text not null,
  admin_notes text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

alter table public.ppl_area_change_requests enable row level security;
create table public.ppl_area_history (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  postcodes text[] default '{}'::text[] not null,
  effective_from timestamp with time zone default now() not null,
  effective_to timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

alter table public.ppl_area_history enable row level security;
create table public.ppl_call_attempts (
  id uuid default gen_random_uuid() not null,
  lead_id uuid not null,
  company_id uuid not null,
  logged_by uuid,
  outcome call_outcome not null,
  notes text,
  attempted_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null
);

alter table public.ppl_call_attempts enable row level security;
create table public.ppl_campaigns (
  id uuid default gen_random_uuid() not null,
  niche text not null,
  area text not null,
  platform text not null,
  campaign_id text not null,
  ad_account_id text,
  status text default 'paused'::text,
  cost_per_lead numeric(10,2),
  is_available boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.ppl_campaigns enable row level security;
create table public.ppl_lead_orders (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  niche text not null,
  area text not null,
  quantity integer not null,
  price_per_lead numeric(10,2) not null,
  total_amount numeric(10,2) not null,
  delivered_count integer default 0,
  status text default 'pending'::text,
  stripe_payment_intent_id text,
  stripe_session_id text,
  campaigns_activated boolean default false,
  twilio_provisioned boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  area_city text,
  radius_km integer,
  postcode_list text,
  location_type text default 'radius'::text,
  sub_niche text,
  custom_link boolean default false,
  checkout_url text,
  service_areas jsonb,
  postcodes text[]
);

alter table public.ppl_lead_orders enable row level security;
create table public.ppl_orders (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  total_leads integer not null,
  delivered_leads integer default 0 not null,
  purchased_at timestamp with time zone default now() not null,
  due_date date not null,
  status text default 'active'::text not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.ppl_orders enable row level security;
create table public.ppl_pricing (
  id uuid default gen_random_uuid() not null,
  niche text not null,
  price_per_lead numeric(10,2) not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  area text,
  sub_niche text,
  sold_out boolean default false not null,
  max_order_qty integer
);

alter table public.ppl_pricing enable row level security;
create table public.preview_links (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  kind text default 'link'::text not null,
  url text not null,
  label text,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

alter table public.preview_links enable row level security;
create table public.profiles (
  id uuid not null,
  company_id uuid not null,
  user_type user_type default 'external'::user_type not null,
  full_name text,
  avatar_url text,
  role text default 'member'::text,
  phone text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  is_admin boolean default false not null,
  a2hs_dismissed boolean default false not null,
  is_team boolean default false not null,
  inactive_marked_at timestamp with time zone,
  deletion_notice_sent_at timestamp with time zone,
  deletion_token uuid,
  team_reply_to_email text,
  team_role text default 'csm'::text not null,
  lead_notify_enabled boolean default false not null,
  lead_notify_channel text default 'email'::text not null,
  lead_notify_email text,
  lead_notify_phone text
);

alter table public.profiles enable row level security;
create table public.quote_drafts (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  lead_id uuid,
  conversation_id uuid,
  status text default 'draft'::text not null,
  draft_text text,
  line_items jsonb default '[]'::jsonb not null,
  subtotal numeric default 0 not null,
  tax numeric default 0 not null,
  total numeric default 0 not null,
  source_run_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.quote_drafts enable row level security;
create table public.quote_followup_queue (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  lead_id uuid,
  quote_id uuid,
  conversation_id uuid,
  status text,
  scheduled_at timestamp with time zone,
  sent_at timestamp with time zone,
  message_body text,
  metadata jsonb
);

alter table public.quote_followup_queue enable row level security;
create table public.quotes (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  lead_id uuid,
  created_by uuid,
  quote_number text not null,
  status quote_status default 'draft'::quote_status,
  subtotal numeric(12,2) default 0,
  tax numeric(12,2) default 0,
  total numeric(12,2) default 0,
  valid_until date,
  notes text,
  line_items jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,
  sent_at timestamp with time zone,
  viewed_at timestamp with time zone,
  accepted_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  quote_token text
);

alter table public.quotes enable row level security;
create table public.review_requests (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  lead_id uuid not null,
  status text default 'pending'::text not null,
  scheduled_at timestamp with time zone not null,
  sent_at timestamp with time zone,
  message_body text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.review_requests enable row level security;
create table public.sales (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  quote_id uuid,
  lead_id uuid,
  closed_by uuid,
  status sale_status default 'pending'::sale_status,
  amount numeric(12,2) default 0 not null,
  currency text default 'USD'::text,
  notes text,
  metadata jsonb default '{}'::jsonb,
  closed_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table public.sales_rep_invites (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  invited_by uuid not null,
  email text not null,
  full_name text,
  phone text,
  status text default 'pending'::text not null,
  auth_user_id uuid,
  sales_rep_id uuid,
  invite_token text,
  metadata jsonb default '{}'::jsonb not null,
  invited_at timestamp with time zone default now() not null,
  accepted_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.sales_rep_invites enable row level security;
create table public.sales_reps (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  user_id uuid not null,
  name text not null,
  email text,
  phone text,
  is_active boolean default true,
  leads_visibility rep_visibility default 'assigned_only'::rep_visibility,
  quotes_visibility rep_visibility default 'assigned_only'::rep_visibility,
  appointments_visibility rep_visibility default 'assigned_only'::rep_visibility,
  sales_visibility rep_visibility default 'assigned_only'::rep_visibility,
  conversations_visibility rep_visibility default 'assigned_only'::rep_visibility,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  can_edit_leads boolean default false not null,
  can_edit_quotes boolean default false not null,
  can_edit_appointments boolean default false not null,
  can_manage_pipeline boolean default false not null,
  can_send_sms boolean default false not null,
  can_initiate_calls boolean default false not null
);

alter table public.sales_reps enable row level security;
alter table public.sales enable row level security;
create table public.signup_attempts (
  id uuid default gen_random_uuid() not null,
  type text not null,
  first_name text,
  last_name text,
  email text,
  phone text,
  company text,
  niche text,
  area_city text,
  quantity integer,
  price_per_lead numeric(10,2),
  industry text,
  service_location text,
  service_radius text,
  special_offers text,
  stripe_session_id text,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now(),
  sub_niche text,
  service_areas jsonb,
  areas jsonb
);

alter table public.signup_attempts enable row level security;
create table public.sms_agent_config (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  name text default 'Default SMS Agent'::text not null,
  system_prompt text,
  twilio_number text,
  model text default 'gpt-4o'::text,
  auto_reply boolean default true,
  reply_delay integer default 0,
  max_messages integer default 50,
  business_hours jsonb default '{}'::jsonb,
  out_of_hours_msg text,
  is_active boolean default true,
  settings jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  callback_enabled boolean default false not null,
  onsite_enabled boolean default false not null,
  quote_drafting_enabled boolean default false not null,
  lead_scoring_enabled boolean default false not null,
  use_company_keys boolean,
  callback_days jsonb default '["tuesday", "wednesday", "friday", "saturday"]'::jsonb not null,
  callback_start_time text default '09:00'::text not null,
  callback_end_time text default '17:00'::text not null,
  max_sms_words integer default 15 not null,
  callback_hours_start time without time zone default '09:00:00'::time without time zone,
  callback_hours_end time without time zone default '17:00:00'::time without time zone,
  company_name text,
  company_area text,
  service_description text,
  auto_call_inbound boolean default false,
  agent_name text,
  special_offers text,
  welcome_message text default 'Hi {{first_name}}, thanks for reaching out!'::text,
  service_locations jsonb default '[]'::jsonb,
  max_travel_distance integer default 50,
  max_travel_distance_unit text default 'km'::text,
  preparation_required text,
  automate_quote_followup boolean default false,
  followup_message text default 'Hi {{first_name}}, just following up on your quote!'::text,
  days_until_followup integer default 3,
  ai_nurture_enabled boolean default true,
  reply_delay_seconds integer default 0,
  quote_pricing_config jsonb default '{}'::jsonb,
  auto_send_welcome boolean default false,
  out_of_hours_only boolean default false not null,
  review_enabled boolean default false,
  review_delay_days integer default 7,
  review_auto_send boolean default false,
  review_message text default 'Hi {{first_name}}, thank you for choosing us! We''d love your feedback — please leave us a Google review: {{review_link}}'::text,
  google_review_link text
);

alter table public.sms_agent_config enable row level security;
create table public.sms_credits (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  balance integer default 0 not null,
  lifetime_used integer default 0 not null,
  updated_at timestamp with time zone default now(),
  monthly_free_sms integer default 500 not null,
  next_reset_at timestamp with time zone
);

alter table public.sms_credits enable row level security;
create table public.sms_opt_outs (
  company_id uuid not null,
  phone text not null,
  opted_out boolean default true not null,
  source text,
  updated_at timestamp with time zone default now() not null
);

alter table public.sms_opt_outs force row level security;
alter table public.sms_opt_outs enable row level security;
create table public.stock_assets (
  id uuid default gen_random_uuid() not null,
  trades text[] default '{}'::text[] not null,
  kind text not null,
  path text not null,
  content_type text,
  width integer,
  height integer,
  bytes bigint,
  label text,
  active boolean default true not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

alter table public.stock_assets force row level security;
alter table public.stock_assets enable row level security;
create table public.stripe_webhook_events (
  id text not null,
  type text not null,
  received_at timestamp with time zone default now() not null
);

alter table public.stripe_webhook_events enable row level security;
create table public.team_assignments (
  id uuid default gen_random_uuid() not null,
  team_user_id uuid not null,
  company_id uuid not null,
  created_at timestamp with time zone default now() not null
);

alter table public.team_assignments force row level security;
alter table public.team_assignments enable row level security;
create table public.team_availability (
  team_user_id uuid not null,
  slots jsonb default '[]'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.team_availability force row level security;
alter table public.team_availability enable row level security;
create table public.team_role_permissions (
  role text not null,
  all_clients boolean default false not null,
  fulfilment_view boolean default false not null,
  fulfilment_edit boolean default false not null,
  automations_run boolean default false not null,
  intro_email_send boolean default false not null,
  preview_email_send boolean default false not null,
  invoices_manage boolean default false not null,
  signups_review boolean default false not null,
  assignments_manage boolean default false not null,
  updated_at timestamp with time zone,
  updated_by uuid,
  calls_make boolean default false not null,
  sms_send boolean default false not null
);

alter table public.team_role_permissions force row level security;
alter table public.team_role_permissions enable row level security;
create table public.team_sms_message (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  contact_id uuid,
  direction text not null,
  from_number text not null,
  to_number text not null,
  body text default ''::text not null,
  twilio_sid text,
  status text,
  error_code text,
  actor_id uuid,
  actor_name text,
  read_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

alter table public.team_sms_message force row level security;
alter table public.team_sms_message enable row level security;
create table public.twilio_numbers (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  sms_config_id uuid,
  phone_number text not null,
  friendly_name text,
  is_active boolean default true not null,
  settings jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  twilio_sid text
);

alter table public.twilio_numbers enable row level security;
create table public.voice_agent_config (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  vapi_assistant_id text,
  name text default 'Default Voice Agent'::text not null,
  system_prompt text,
  greeting text,
  voice_id text,
  model text default 'gpt-4o'::text,
  max_duration integer default 300,
  transfer_phone text,
  is_active boolean default true,
  settings jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  vapi_phone_number_id text
);

alter table public.voice_agent_config enable row level security;
create table public.voice_calls (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  lead_id uuid,
  conversation_id uuid,
  assigned_to uuid,
  voice_config_id uuid,
  vapi_call_id text,
  direction call_direction not null,
  status call_status default 'ringing'::call_status,
  from_number text,
  to_number text,
  duration integer,
  recording_url text,
  transcript text,
  summary text,
  sentiment text,
  outcome text,
  cost numeric(8,4),
  metadata jsonb default '{}'::jsonb,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

alter table public.voice_calls enable row level security;
create table public.volume_discount_tiers (
  id uuid default gen_random_uuid() not null,
  min_quantity integer not null,
  discount_percent integer not null,
  label text not null,
  is_popular boolean default false not null,
  active boolean default true not null,
  sort_order integer default 0 not null
);

alter table public.volume_discount_tiers enable row level security;
create table public.webhook_deliveries (
  id uuid default gen_random_uuid() not null,
  webhook_id uuid not null,
  company_id uuid not null,
  event text not null,
  payload jsonb default '{}'::jsonb not null,
  response_status integer,
  response_body text,
  attempt integer default 1 not null,
  success boolean default false not null,
  created_at timestamp with time zone default now() not null
);

alter table public.webhook_deliveries enable row level security;
create table public.webhook_endpoints (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  url text not null,
  events jsonb default '["lead.created", "quote.accepted", "appointment.booked"]'::jsonb not null,
  secret text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

alter table public.webhook_endpoints enable row level security;

-- ===== Keys, unique and check constraints =====
alter table public.activity_log add constraint activity_log_pkey PRIMARY KEY (id);
alter table public.agency_key_mappings add constraint agency_key_mappings_company_id_provider_label_key UNIQUE (company_id, provider, label);
alter table public.agency_key_mappings add constraint agency_key_mappings_pkey PRIMARY KEY (id);
alter table public.ai_performance_stats add constraint ai_performance_stats_company_id_period_period_start_key UNIQUE (company_id, period, period_start);
alter table public.ai_performance_stats add constraint ai_performance_stats_period_check CHECK ((period = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'all_time'::text])));
alter table public.ai_performance_stats add constraint ai_performance_stats_pkey PRIMARY KEY (id);
alter table public.ai_workflow_runs add constraint ai_workflow_runs_key_source_check CHECK ((key_source = ANY (ARRAY['agency'::text, 'customer'::text])));
alter table public.ai_workflow_runs add constraint ai_workflow_runs_pkey PRIMARY KEY (id);
alter table public.ai_workflow_runs add constraint ai_workflow_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'skipped'::text])));
alter table public.api_keys add constraint api_keys_company_id_provider_label_key UNIQUE (company_id, provider, label);
alter table public.api_keys add constraint api_keys_pkey PRIMARY KEY (id);
alter table public.appointments add constraint appointments_pkey PRIMARY KEY (id);
alter table public.au_postcode_points add constraint au_postcode_points_pkey PRIMARY KEY (postcode, lat, lng);
alter table public.business_settings add constraint business_settings_pkey PRIMARY KEY (id);
alter table public.business_settings add constraint business_settings_singleton CHECK ((id = 1));
alter table public.call_log add constraint call_log_pkey PRIMARY KEY (id);
alter table public.call_log add constraint call_log_twilio_call_sid_key UNIQUE (twilio_call_sid);
alter table public.campaign_builds add constraint campaign_builds_pkey PRIMARY KEY (id);
alter table public.campaign_builds add constraint campaign_builds_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'building'::text, 'built'::text, 'needs_team'::text, 'failed'::text, 'replaced'::text])));
alter table public.client_email_log add constraint client_email_log_pkey PRIMARY KEY (id);
alter table public.client_notes add constraint client_notes_pkey PRIMARY KEY (id);
alter table public.client_reminders add constraint client_reminders_company_id_kind_key UNIQUE (company_id, kind);
alter table public.client_reminders add constraint client_reminders_pkey PRIMARY KEY (id);
alter table public.companies add constraint companies_approval_token_key UNIQUE (approval_token);
alter table public.companies add constraint companies_creative_source_check CHECK ((creative_source = ANY (ARRAY['custom'::text, 'stock'::text])));
alter table public.companies add constraint companies_management_fee_cents_check CHECK (((management_fee_cents IS NULL) OR ((management_fee_cents >= 0) AND (management_fee_cents <= 5000000))));
alter table public.companies add constraint companies_meta_dataset_id_digits CHECK (((meta_dataset_id IS NULL) OR (meta_dataset_id ~ '^[0-9]{6,20}$'::text)));
alter table public.companies add constraint companies_pkey PRIMARY KEY (id);
alter table public.companies add constraint companies_slug_key UNIQUE (slug);
alter table public.company_api_tokens add constraint company_api_tokens_pkey PRIMARY KEY (id);
alter table public.company_assets add constraint company_assets_kind_check CHECK ((kind = ANY (ARRAY['logo'::text, 'photo'::text, 'video'::text])));
alter table public.company_assets add constraint company_assets_pkey PRIMARY KEY (id);
alter table public.company_assets add constraint company_assets_source_check CHECK ((source = ANY (ARRAY['team'::text, 'client'::text, 'stock'::text])));
alter table public.company_assets add constraint company_assets_storage_check CHECK ((storage = ANY (ARRAY['supabase'::text, 'r2'::text])));
alter table public.company_capi_tokens add constraint company_capi_tokens_pkey PRIMARY KEY (company_id);
alter table public.company_fulfilment add constraint company_fulfilment_company_id_step_key_key UNIQUE (company_id, step_key);
alter table public.company_fulfilment add constraint company_fulfilment_pkey PRIMARY KEY (id);
alter table public.company_fulfilment add constraint company_fulfilment_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'blocked'::text, 'done'::text, 'skipped'::text])));
alter table public.company_fulfilment_summary add constraint company_fulfilment_summary_pkey PRIMARY KEY (company_id);
alter table public.company_knowledge add constraint company_knowledge_category_check CHECK ((category = ANY (ARRAY['winning_pattern'::text, 'failed_pattern'::text, 'objection_response'::text, 'scheduling_approach'::text, 'quote_approach'::text, 'service_insight'::text, 'style_preference'::text])));
alter table public.company_knowledge add constraint company_knowledge_pkey PRIMARY KEY (id);
alter table public.company_knowledge add constraint company_knowledge_source_type_check CHECK ((source_type = ANY (ARRAY['sms'::text, 'voice'::text, 'quote'::text, 'mixed'::text])));
alter table public.conversations add constraint conversations_pkey PRIMARY KEY (id);
alter table public.creative_rounds add constraint creative_rounds_company_id_round_key UNIQUE (company_id, round);
alter table public.creative_rounds add constraint creative_rounds_pkey PRIMARY KEY (id);
alter table public.creative_rounds add constraint creative_rounds_status_check CHECK ((status = ANY (ARRAY['building'::text, 'drawing'::text, 'team_review'::text, 'preparing'::text, 'sent'::text, 'approved'::text, 'changes_requested'::text, 'superseded'::text])));
alter table public.custom_fields add constraint custom_fields_company_entity_key_key UNIQUE (company_id, entity_type, field_key);
alter table public.custom_fields add constraint custom_fields_entity_type_check CHECK ((entity_type = 'lead'::text));
alter table public.custom_fields add constraint custom_fields_field_type_check CHECK ((field_type = ANY (ARRAY['text'::text, 'textarea'::text, 'number'::text, 'date'::text, 'boolean'::text, 'select'::text])));
alter table public.custom_fields add constraint custom_fields_pkey PRIMARY KEY (id);
alter table public.demo_requests add constraint demo_requests_email_check CHECK ((email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::text));
alter table public.demo_requests add constraint demo_requests_pkey PRIMARY KEY (id);
alter table public.elevenlabs_voices add constraint elevenlabs_voices_name_key UNIQUE (name);
alter table public.elevenlabs_voices add constraint elevenlabs_voices_pkey PRIMARY KEY (id);
alter table public.elevenlabs_voices add constraint elevenlabs_voices_voice_id_key UNIQUE (voice_id);
alter table public.email_templates add constraint email_templates_pkey PRIMARY KEY (id);
alter table public.fulfilment_log add constraint fulfilment_log_pkey PRIMARY KEY (id);
alter table public.fulfilment_step_defs add constraint fulfilment_step_defs_owner_role_check CHECK ((owner_role = ANY (ARRAY['team'::text, 'client'::text, 'ops'::text])));
alter table public.fulfilment_step_defs add constraint fulfilment_step_defs_phase_check CHECK ((phase = ANY (ARRAY['onboarding'::text, 'live'::text])));
alter table public.fulfilment_step_defs add constraint fulfilment_step_defs_pkey PRIMARY KEY (step_key);
alter table public.industry_insights add constraint industry_insights_pkey PRIMARY KEY (id);
alter table public.invoices add constraint invoices_pkey PRIMARY KEY (id);
alter table public.lead_custom_field_values add constraint lead_custom_field_values_pkey PRIMARY KEY (id);
alter table public.lead_custom_field_values add constraint lead_custom_field_values_unique UNIQUE (lead_id, custom_field_id);
alter table public.lead_disputes add constraint lead_disputes_pkey PRIMARY KEY (id);
alter table public.lead_notification_log add constraint lead_notification_log_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text])));
alter table public.lead_notification_log add constraint lead_notification_log_lead_id_profile_id_channel_key UNIQUE (lead_id, profile_id, channel);
alter table public.lead_notification_log add constraint lead_notification_log_pkey PRIMARY KEY (id);
alter table public.leads add constraint leads_ai_score_check CHECK (((ai_score >= 0) AND (ai_score <= 100)));
alter table public.leads add constraint leads_lead_score_check CHECK (((lead_score >= 0) AND (lead_score <= 100)));
alter table public.leads add constraint leads_pkey PRIMARY KEY (id);
alter table public.media_uploads add constraint media_uploads_pkey PRIMARY KEY (key);
alter table public.messages add constraint messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])));
alter table public.messages add constraint messages_pkey PRIMARY KEY (id);
alter table public.meta_assets add constraint meta_assets_kind_check CHECK ((kind = ANY (ARRAY['ad_account'::text, 'page'::text, 'pixel'::text])));
alter table public.meta_assets add constraint meta_assets_pkey PRIMARY KEY (kind, meta_id);
alter table public.meta_capi_events add constraint meta_capi_events_pkey PRIMARY KEY (lead_id, event_name);
alter table public.meta_connections add constraint meta_connections_company_id_key UNIQUE (company_id);
alter table public.meta_connections add constraint meta_connections_pkey PRIMARY KEY (id);
alter table public.meta_leads add constraint meta_leads_delivery_check CHECK ((delivery = ANY (ARRAY['make'::text, 'direct'::text])));
alter table public.meta_leads add constraint meta_leads_pkey PRIMARY KEY (leadgen_id);
alter table public.niche_benchmarks add constraint niche_benchmarks_pkey PRIMARY KEY (niche);
alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id);
alter table public.onboarding_submissions add constraint onboarding_submissions_gate_status_check CHECK ((gate_status = ANY (ARRAY['pending'::text, 'matched'::text, 'held'::text, 'approved'::text, 'rejected'::text])));
alter table public.onboarding_submissions add constraint onboarding_submissions_pkey PRIMARY KEY (id);
alter table public.password_reset_tokens add constraint password_reset_tokens_pkey PRIMARY KEY (id);
alter table public.password_reset_tokens add constraint password_reset_tokens_token_hash_key UNIQUE (token_hash);
alter table public.pending_magic_links add constraint pending_magic_links_pkey PRIMARY KEY (stripe_session_id);
alter table public.platform_settings add constraint platform_settings_pkey PRIMARY KEY (id);
alter table public.platform_settings add constraint platform_settings_singleton CHECK ((id = 1));
alter table public.ppl_area_change_requests add constraint ppl_area_change_requests_pkey PRIMARY KEY (id);
alter table public.ppl_area_change_requests add constraint ppl_area_change_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.ppl_area_history add constraint ppl_area_history_pkey PRIMARY KEY (id);
alter table public.ppl_call_attempts add constraint ppl_call_attempts_pkey PRIMARY KEY (id);
alter table public.ppl_campaigns add constraint ppl_campaigns_pkey PRIMARY KEY (id);
alter table public.ppl_campaigns add constraint ppl_campaigns_platform_check CHECK ((platform = ANY (ARRAY['meta'::text, 'google'::text])));
alter table public.ppl_campaigns add constraint ppl_campaigns_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text])));
alter table public.ppl_lead_orders add constraint ppl_lead_orders_pkey PRIMARY KEY (id);
alter table public.ppl_lead_orders add constraint ppl_lead_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'active'::text, 'fulfilled'::text, 'cancelled'::text])));
alter table public.ppl_orders add constraint ppl_orders_delivered_leads_check CHECK ((delivered_leads >= 0));
alter table public.ppl_orders add constraint ppl_orders_pkey PRIMARY KEY (id);
alter table public.ppl_orders add constraint ppl_orders_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text])));
alter table public.ppl_orders add constraint ppl_orders_total_leads_check CHECK ((total_leads > 0));
alter table public.ppl_pricing add constraint ppl_pricing_pkey PRIMARY KEY (id);
alter table public.preview_links add constraint preview_links_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_lead_notify_channel_check CHECK ((lead_notify_channel = ANY (ARRAY['email'::text, 'sms'::text, 'email_sms'::text])));
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_team_role_check CHECK ((team_role = ANY (ARRAY['csm'::text, 'ops_manager'::text, 'media_buyer'::text, 'tech_lead'::text])));
alter table public.quote_drafts add constraint quote_drafts_pkey PRIMARY KEY (id);
alter table public.quote_drafts add constraint quote_drafts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'ready'::text, 'discarded'::text, 'converted'::text])));
alter table public.quote_followup_queue add constraint quote_followup_queue_pkey PRIMARY KEY (id);
alter table public.quote_followup_queue add constraint quote_followup_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'completed'::text, 'cancelled'::text])));
alter table public.quotes add constraint quotes_pkey PRIMARY KEY (id);
alter table public.quotes add constraint quotes_quote_token_key UNIQUE (quote_token);
alter table public.review_requests add constraint review_requests_pkey PRIMARY KEY (id);
alter table public.review_requests add constraint review_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'skipped'::text, 'failed'::text])));
alter table public.sales add constraint sales_pkey PRIMARY KEY (id);
alter table public.sales_rep_invites add constraint sales_rep_invites_company_email_key UNIQUE (company_id, email);
alter table public.sales_rep_invites add constraint sales_rep_invites_pkey PRIMARY KEY (id);
alter table public.sales_rep_invites add constraint sales_rep_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text, 'expired'::text])));
alter table public.sales_reps add constraint sales_reps_company_id_user_id_key UNIQUE (company_id, user_id);
alter table public.sales_reps add constraint sales_reps_pkey PRIMARY KEY (id);
alter table public.signup_attempts add constraint signup_attempts_pkey PRIMARY KEY (id);
alter table public.sms_agent_config add constraint sms_agent_config_company_id_key UNIQUE (company_id);
alter table public.sms_agent_config add constraint sms_agent_config_pkey PRIMARY KEY (id);
alter table public.sms_credits add constraint sms_credits_company_id_key UNIQUE (company_id);
alter table public.sms_credits add constraint sms_credits_pkey PRIMARY KEY (id);
alter table public.sms_opt_outs add constraint sms_opt_outs_pkey PRIMARY KEY (company_id, phone);
alter table public.stock_assets add constraint stock_assets_kind_check CHECK ((kind = ANY (ARRAY['photo'::text, 'video'::text])));
alter table public.stock_assets add constraint stock_assets_path_key UNIQUE (path);
alter table public.stock_assets add constraint stock_assets_pkey PRIMARY KEY (id);
alter table public.stripe_webhook_events add constraint stripe_webhook_events_pkey PRIMARY KEY (id);
alter table public.team_assignments add constraint va_assignments_pkey PRIMARY KEY (id);
alter table public.team_assignments add constraint va_assignments_va_user_id_company_id_key UNIQUE (team_user_id, company_id);
alter table public.team_availability add constraint va_availability_pkey PRIMARY KEY (team_user_id);
alter table public.team_role_permissions add constraint team_role_permissions_pkey PRIMARY KEY (role);
alter table public.team_role_permissions add constraint team_role_permissions_role_check CHECK ((role = ANY (ARRAY['csm'::text, 'ops_manager'::text, 'media_buyer'::text, 'tech_lead'::text])));
alter table public.team_sms_message add constraint team_sms_message_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])));
alter table public.team_sms_message add constraint team_sms_message_pkey PRIMARY KEY (id);
alter table public.team_sms_message add constraint team_sms_message_twilio_sid_key UNIQUE (twilio_sid);
alter table public.twilio_numbers add constraint twilio_numbers_company_phone_unique UNIQUE (company_id, phone_number);
alter table public.twilio_numbers add constraint twilio_numbers_pkey PRIMARY KEY (id);
alter table public.voice_agent_config add constraint voice_agent_config_company_id_key UNIQUE (company_id);
alter table public.voice_agent_config add constraint voice_agent_config_pkey PRIMARY KEY (id);
alter table public.voice_calls add constraint voice_calls_pkey PRIMARY KEY (id);
alter table public.volume_discount_tiers add constraint volume_discount_tiers_pkey PRIMARY KEY (id);
alter table public.webhook_deliveries add constraint webhook_deliveries_pkey PRIMARY KEY (id);
alter table public.webhook_endpoints add constraint webhook_endpoints_pkey PRIMARY KEY (id);

-- ===== Functions =====
CREATE OR REPLACE FUNCTION public.add_sms_credits(p_company_id uuid, p_amount integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.sms_credits (company_id, balance)
  values (p_company_id, p_amount)
  on conflict (company_id) do update
    set balance    = sms_credits.balance + excluded.balance,
        updated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ai_live_leads()
 RETURNS TABLE(lead_id uuid, company_id uuid, ai_score numeric, replied boolean, callback_booked boolean, callback_mode boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with ai_msgs as (
    select c.lead_id, l.company_id, m.created_at
    from messages m
    join conversations c on c.id = m.conversation_id
    join leads l         on l.id = c.lead_id
    join companies co    on co.id = l.company_id
    where m.is_ai_generated
      and m.direction = 'outbound'
      and m.created_at >= co.created_at          -- ignore imported history
  ),
  inbound as (
    select c.lead_id, m.created_at
    from messages m
    join conversations c on c.id = m.conversation_id
    where m.direction = 'inbound' and c.lead_id is not null
  ),
  -- AI messages that answered something the lead said = AI was live
  live_replies as (
    select a.lead_id, a.company_id, a.created_at
    from ai_msgs a
    where exists (select 1 from inbound i where i.lead_id = a.lead_id and i.created_at < a.created_at)
  ),
  per_lead as (
    select
      a.lead_id, a.company_id, min(a.created_at) as first_ai_at,
      exists (select 1 from live_replies r where r.lead_id = a.lead_id) as answered
    from ai_msgs a
    group by a.lead_id, a.company_id
  ),
  scoped as (
    select
      p.*,
      exists (select 1 from inbound i where i.lead_id = p.lead_id and i.created_at > p.first_ai_at) as replied
    from per_lead p
  )
  select
    s.lead_id, s.company_id, l.ai_score::numeric, s.replied,
    exists (
      select 1 from appointments ap
      where ap.lead_id = s.lead_id and ap.booked_by = 'ai' and ap.appointment_type = 'callback'
    ),
    coalesce(cfg.callback_enabled, false) and not coalesce(cfg.quote_drafting_enabled, false)
  from scoped s
  join leads l on l.id = s.lead_id
  left join sms_agent_config cfg on cfg.company_id = s.company_id
  where s.answered
     or (not s.replied and exists (
           select 1 from live_replies r
           where r.company_id = s.company_id
             and r.created_at between s.first_ai_at - interval '7 days'
                                  and s.first_ai_at + interval '7 days'));
$function$
;

CREATE OR REPLACE FUNCTION public.assign_shared_number_to_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  shared text;
begin
  if exists (select 1 from public.twilio_numbers where company_id = new.id) then
    return new;
  end if;

  select shared_ppl_twilio_number into shared from public.platform_settings where id = 1;
  if shared is null or shared = '' then
    return new;
  end if;

  insert into public.twilio_numbers (company_id, phone_number, friendly_name)
  values (new.id, shared, 'QuoteLeads SMS (shared PPL number)')
  on conflict (company_id, phone_number) do nothing;

  update public.sms_agent_config
     set twilio_number = shared
   where company_id = new.id
     and (twilio_number is null or twilio_number = '');

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.autopilot_secret_ok(p text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'autopilot_secret' and decrypted_secret = p
  )
$function$
;

CREATE OR REPLACE FUNCTION public.check_rep_limit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if (
    select count(*) from public.sales_reps
    where company_id = new.company_id
  ) >= 10 then
    raise exception 'Maximum of 10 sales reps per company reached.';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clean_expired_magic_links()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  delete from public.pending_magic_links where expires_at < now();
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_expired_reset_tokens()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    DELETE FROM public.password_reset_tokens
    WHERE expires_at < now() - interval '24 hours';
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.company_engagement_stats(p_company_id uuid)
 RETURNS TABLE(ai_leads integer, callback_rate numeric, reply_rate numeric, lead_score numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    count(*)::int,
    case when bool_and(al.callback_mode) then
      round(100.0 * count(*) filter (where al.callback_booked) / nullif(count(*), 0), 1) end,
    round(100.0 * count(*) filter (where al.replied) / nullif(count(*), 0), 1),
    round(avg(al.ai_score) filter (where al.ai_score > 0), 0)
  from ai_live_leads() al
  where al.company_id = p_company_id;
$function$
;

CREATE OR REPLACE FUNCTION public.company_fulfilment_recalc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.recalc_company_fulfilment(coalesce(NEW.company_id, OLD.company_id));
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.company_fulfilment_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();

  -- completed_at follows status rather than being passed in, so a reopened step
  -- cannot keep a stale completion date.
  IF NEW.status IN ('done','skipped') THEN
    IF NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;

  IF NEW.status <> 'pending' AND NEW.started_at IS NULL THEN
    NEW.started_at := now();
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.count_active_and_pending_sales_reps(p_company_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce((
      select count(*)
      from public.sales_reps
      where company_id = p_company_id
        and is_active = true
    ), 0)
    +
    coalesce((
      select count(*)
      from public.sales_rep_invites
      where company_id = p_company_id
        and status = 'pending'
    ), 0);
$function$
;

CREATE OR REPLACE FUNCTION public.current_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select company_id from public.profiles where id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.decrypt_api_key(p_encrypted bytea, p_company_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_passphrase text;
begin
  select decrypted_secret into v_passphrase
    from vault.decrypted_secrets
    where name = 'app_encryption_key'
    limit 1;

  if v_passphrase is null then
    raise exception 'Encryption key not found in Vault.';
  end if;

  return extensions.pgp_sym_decrypt(
    p_encrypted,
    v_passphrase || '::' || p_company_id::text
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.deduct_sms_credit(p_company_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance int;
begin
  update public.sms_credits
    set balance = balance - 1,
        lifetime_used = lifetime_used + 1,
        updated_at = now()
    where company_id = p_company_id
      and balance > 0
    returning balance into v_balance;

  return found;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.default_lead_notify_on_new_owner()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.role = 'owner'
     and coalesce(new.user_type::text, 'external') <> 'internal' then
    new.lead_notify_enabled := true;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.encrypt_api_key(p_raw_key text, p_company_id uuid)
 RETURNS bytea
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_passphrase text;
begin
  -- Retrieve the master encryption key from Vault
  select decrypted_secret into v_passphrase
    from vault.decrypted_secrets
    where name = 'app_encryption_key'
    limit 1;

  if v_passphrase is null then
    raise exception 'Encryption key not found in Vault. Insert a secret named "app_encryption_key".';
  end if;

  return extensions.pgp_sym_encrypt(
    p_raw_key,
    v_passphrase || '::' || p_company_id::text
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_ppl_lead_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(auth.role(), '') <> 'authenticated' or public.is_super_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if lower(trim(coalesce(old.source, ''))) <> 'quoteleads ppl' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'QuoteLeads PPL leads can''t be deleted.'
      using errcode = '42501';
  end if;

  new.name        := old.name;
  new.first_name  := old.first_name;
  new.last_name   := old.last_name;
  new.email       := old.email;
  new.phone       := old.phone;
  new.source      := old.source;
  new.postcode    := old.postcode;
  new.is_ppl      := old.is_ppl;
  new.custom_data := old.custom_data;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_quote_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if new.quote_token is null then
    new.quote_token := replace(replace(encode(gen_random_bytes(24), 'base64'), '/', '_'), '+', '-');
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_email(user_email text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public'
AS $function$
    SELECT id FROM auth.users WHERE lower(email) = lower(user_email) LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_company_capi_token(p_company uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select nullif(s.decrypted_secret, '')
  from public.company_capi_tokens t join vault.decrypted_secrets s on s.id = t.secret_id
  where t.company_id = p_company
$function$
;

CREATE OR REPLACE FUNCTION public.get_ppl_dispute_eligibility(p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead          record;
  v_delivery      timestamptz;
  v_now           timestamptz := now();
  v_days_since    numeric;
  v_window_open   boolean;
  v_call_24h      boolean;
  v_reasons       text[];
  v_days_left     numeric;
begin
  select id, company_id, is_ppl, created_at
  into v_lead
  from public.leads
  where id = p_lead_id;

  if not found then
    return jsonb_build_object('error', 'Lead not found');
  end if;

  if not v_lead.is_ppl then
    return jsonb_build_object('error', 'Not a PPL lead');
  end if;

  v_delivery   := v_lead.created_at;
  v_days_since := extract(epoch from (v_now - v_delivery)) / 86400.0;
  v_window_open := v_days_since <= 7;
  v_days_left   := greatest(0, round((7 - v_days_since)::numeric, 1));

  -- Was any call attempt logged within the first 24 hours of delivery?
  select exists (
    select 1 from public.ppl_call_attempts
    where lead_id = p_lead_id
      and attempted_at >= v_delivery
      and attempted_at <  v_delivery + interval '24 hours'
  ) into v_call_24h;

  -- Build the eligible reason list
  if v_window_open then
    v_reasons := array['duplicate', 'outside_agreed_criteria'];
    if v_call_24h then
      v_reasons := array['invalid_number', 'duplicate', 'outside_agreed_criteria'];
    end if;
  else
    v_reasons := array[]::text[];
  end if;

  return jsonb_build_object(
    'dispute_window_open',  v_window_open,
    'days_since_delivery',  round(v_days_since::numeric, 1),
    'days_remaining',       v_days_left,
    'call_within_24h',      v_call_24h,
    'eligible_reasons',     to_jsonb(v_reasons),
    'delivery_at',          v_delivery
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_ppl_scrub_usage(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total_ppl   bigint;
  v_approved    bigint;
  v_scrub_cap   numeric(5,2);
  v_scrub_used  numeric(5,2);
begin
  select count(*)
  into v_total_ppl
  from public.leads
  where company_id = p_company_id and is_ppl = true;

  select count(*)
  into v_approved
  from public.lead_disputes
  where company_id = p_company_id
    and status in ('auto_approved', 'manual_approved');

  select ppl_scrub_cap_pct
  into v_scrub_cap
  from public.companies
  where id = p_company_id;

  if v_total_ppl = 0 then
    v_scrub_used := 0;
  else
    v_scrub_used := round(
      (v_approved::numeric / v_total_ppl::numeric) * 100, 2
    );
  end if;

  return jsonb_build_object(
    'total_ppl_leads',   v_total_ppl,
    'approved_disputes', v_approved,
    'scrub_cap_pct',     coalesce(v_scrub_cap, 10),
    'scrub_used_pct',    v_scrub_used,
    'cap_exceeded',      v_scrub_used >= coalesce(v_scrub_cap, 10)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_rep_visibility(p_user_id uuid, p_section text)
 RETURNS rep_visibility
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_visibility public.rep_visibility;
  v_role text;
begin
  -- Owners/admins always see everything
  select role into v_role from public.profiles where id = p_user_id;
  if v_role in ('owner', 'admin') then
    return 'all';
  end if;

  -- Check rep record
  execute format(
    'select %I from public.sales_reps where user_id = $1 and is_active = true limit 1',
    p_section || '_visibility'
  ) into v_visibility using p_user_id;

  return coalesce(v_visibility, 'none');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company_id          uuid;
  v_provided_company_id uuid;
  v_user_type           public.user_type := 'internal';
  v_full_name           text;
begin
  -- Pull metadata supplied at signup / invite
  v_full_name           := coalesce(new.raw_user_meta_data ->> 'full_name', '');
  v_user_type           := coalesce(
                             (new.raw_user_meta_data ->> 'user_type')::public.user_type,
                             'internal'
                           );
  v_provided_company_id := (new.raw_user_meta_data ->> 'company_id')::uuid;
  v_company_id          := v_provided_company_id;

  -- If no company_id was supplied, create a new company for this user
  if v_company_id is null then
    insert into public.companies (name, slug)
    values (
      coalesce(new.raw_user_meta_data ->> 'company_name', v_full_name || '''s Company'),
      'co-' || substr(new.id::text, 1, 8)
    )
    returning id into v_company_id;
  end if;

  insert into public.profiles (id, company_id, user_type, full_name, role)
  values (
    new.id,
    v_company_id,
    v_user_type,
    v_full_name,
    -- Signup (no company_id provided → new company created) → owner
    -- Invite  (company_id provided)                         → member
    case when v_provided_company_id is null then 'owner' else 'member' end
  );

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_result boolean;
begin
  select role into v_role from public.profiles where id = p_user_id;
  if v_role in ('owner', 'admin') then
    return true;
  end if;

  execute format(
    'select %I from public.sales_reps where user_id = $1 and is_active = true limit 1',
    p_permission
  ) into v_result using p_user_id;

  return coalesce(v_result, false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_ppl_order_delivered()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id           uuid;
  v_total              int;
  v_new_delivered      int;
  v_lead_order_id      uuid;
  v_lead_quantity      int;
  v_new_lead_delivered int;
  v_postcode           text := nullif(trim(coalesce(NEW.postcode, '')), '');
begin
  if not (
    NEW.is_ppl = true and
    (TG_OP = 'INSERT' or coalesce(OLD.is_ppl, false) = false)
  ) then
    return NEW;
  end if;

  select id, total_leads
  into v_order_id, v_total
  from public.ppl_orders
  where company_id = NEW.company_id
    and status = 'active'
  order by purchased_at asc
  limit 1;

  if v_order_id is not null then
    update public.ppl_orders
    set delivered_leads = delivered_leads + 1,
        updated_at      = now()
    where id = v_order_id
    returning delivered_leads into v_new_delivered;

    if v_new_delivered >= v_total then
      update public.ppl_orders
      set status     = 'completed',
          updated_at = now()
      where id = v_order_id;
    end if;
  end if;

  if v_postcode is not null then
    select id, quantity
    into v_lead_order_id, v_lead_quantity
    from public.ppl_lead_orders
    where company_id = NEW.company_id
      and status = 'active'
      and delivered_count < quantity
      and postcodes @> array[v_postcode]
    order by created_at asc
    limit 1;
  end if;

  if v_lead_order_id is null then
    select id, quantity
    into v_lead_order_id, v_lead_quantity
    from public.ppl_lead_orders
    where company_id = NEW.company_id
      and status = 'active'
      and delivered_count < quantity
    order by (postcodes is not null), created_at asc
    limit 1;
  end if;

  if v_lead_order_id is not null then
    update public.ppl_lead_orders
    set delivered_count = delivered_count + 1,
        updated_at      = now()
    where id = v_lead_order_id
    returning delivered_count into v_new_lead_delivered;

    if v_new_lead_delivered >= v_lead_quantity then
      update public.ppl_lead_orders
      set status     = 'fulfilled',
          updated_at = now()
      where id = v_lead_order_id;
    end if;
  end if;

  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when auth.uid() is null then false
    else coalesce(
      (select is_admin from public.profiles where id = auth.uid()),
      false
    )
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.leads_normalise_phone()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.phone := public.normalise_au_phone(new.phone);
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.media_cleanup_secret_ok(p text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'media_cleanup_secret' and decrypted_secret = p
  )
$function$
;

CREATE OR REPLACE FUNCTION public.meta_watch_secret_ok(p text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'meta_watch_secret' and decrypted_secret = p
  )
$function$
;

CREATE OR REPLACE FUNCTION public.norm_au_phone(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p is null then null
    else (
      select case
        when v like '04%'  then '+61' || substr(v, 2)
        when v like '614%' then '+' || v
        when v like '61%'  then '+' || v
        else v
      end
      from (select regexp_replace(p, '[\s\-().]', '', 'g') as v) s
    )
  end
$function$
;

CREATE OR REPLACE FUNCTION public.normalise_au_phone(raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  d text;
begin
  if raw is null or btrim(raw) = '' then
    return raw;
  end if;

  d := regexp_replace(raw, '\D', '', 'g');

  -- 0 + [2-478] + 8 digits: AU national format, mobile or landline.
  if d ~ '^0[2-478][0-9]{8}$' then
    return '+61' || substr(d, 2);
  end if;

  -- 61 + [2-478] + 8 digits: E.164 that lost its plus.
  if d ~ '^61[2-478][0-9]{8}$' then
    return '+' || d;
  end if;

  -- Not recognisably Australian. Keep it exactly as given - a French or Thai
  -- number is data, not an error, and inventing a +61 for it would be worse
  -- than leaving it alone.
  return btrim(raw);
end $function$
;

CREATE OR REPLACE FUNCTION public.notify_new_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_supabase_url text := coalesce(
    nullif(current_setting('app.settings.supabase_url', true), ''),
    'https://wjadekgptkstfdootuol.supabase.co'
  );
  v_service_key  text := nullif(current_setting('app.settings.service_role_key', true), '');
  v_headers      jsonb := jsonb_build_object('Content-Type', 'application/json');
begin
  if not exists (
    select 1 from public.profiles
    where company_id = new.company_id
      and lead_notify_enabled = true
      and coalesce(is_active, true) = true
  ) then
    return new;
  end if;

  if v_service_key is not null then
    v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_service_key);
  end if;

  perform net.http_post(
    url     := v_supabase_url || '/functions/v1/lead-notify',
    headers := v_headers,
    body    := jsonb_build_object('lead_id', new.id),
    timeout_milliseconds := 30000
  );

  return new;
exception
  when others then
    raise warning 'notify_new_lead failed: %', sqlerrm;
    return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_ppl_area_change_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_supabase_url text := coalesce(
    nullif(current_setting('app.settings.supabase_url', true), ''),
    'https://wjadekgptkstfdootuol.supabase.co'
  );
  v_company_name text;
  v_msg          text;
begin
  select name into v_company_name
  from public.companies
  where id = new.company_id;

  v_msg := replace(replace(replace(coalesce(new.message, '(no message)'),
             '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

  perform net.http_post(
    url     := v_supabase_url || '/functions/v1/notify-internal',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'subject', 'PPL Area Change Request — ' || coalesce(v_company_name, 'Unknown Company'),
      'body', '<html><body style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;padding:32px;color:#111827">'
        || '<h2 style="margin:0 0 16px">PPL Service Area Change Request</h2>'
        || '<p><strong>Company:</strong> ' || coalesce(v_company_name, 'Unknown') || '</p>'
        || '<p><strong>Message:</strong> ' || v_msg || '</p>'
        || '<p><strong>Submitted:</strong> ' || to_char(new.created_at at time zone 'Australia/Sydney', 'DD Mon YYYY HH24:MI') || ' AEST</p>'
        || '<p style="margin-top:24px"><a href="https://quoteleadshq.com/admin.html" style="color:#1f6fff">Review in Admin</a></p>'
        || '</body></html>'
    )
  );

  return new;
exception
  when others then
    raise warning 'notify_ppl_area_change_request failed: %', sqlerrm;
    return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.on_quote_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.lead_id is not null then
    update public.leads
      set pipeline_stage = 'quote_in_progress'
      where id = new.lead_id
        and pipeline_stage in ('new_lead', 'follow_up');
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.on_quote_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'sent' and old.status != 'sent' and new.lead_id is not null then
    update public.leads
      set pipeline_stage = 'quoted'
      where id = new.lead_id
        and pipeline_stage in ('new_lead', 'follow_up', 'quote_in_progress');
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.on_sale_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'completed' then
    if new.lead_id is not null then
      update public.leads
        set pipeline_stage = 'closed_won'
        where id = new.lead_id;
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.onboarding_submissions_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ppl_agreed_postcodes_at(p_company_id uuid, p_at timestamp with time zone)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (
      select postcodes
      from public.ppl_area_history
      where company_id = p_company_id
        and effective_from <= p_at
        and (effective_to is null or effective_to > p_at)
      order by effective_from desc
      limit 1
    ),
    (select ppl_agreed_postcodes from public.companies where id = p_company_id),
    '{}'::text[]
  );
$function$
;

CREATE OR REPLACE FUNCTION public.ppl_open_area_postcodes()
 RETURNS TABLE(company_id uuid, postcodes text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.company_id,
         coalesce(array_agg(distinct pc order by pc)
                    filter (where o.status = 'active' and o.delivered_count < o.quantity and pc is not null), '{}')
  from public.ppl_lead_orders o
  left join lateral unnest(o.postcodes) pc on true
  where o.status in ('active', 'fulfilled')
  group by o.company_id
  having bool_or(o.postcodes is not null)
     and not bool_or(o.status = 'active' and o.postcodes is null)
$function$
;

CREATE OR REPLACE FUNCTION public.ppl_postcodes_in_state(p_state text)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(distinct postcode order by postcode), '{}')
  from public.au_postcode_points
  where state = case lower(trim(p_state))
    when 'queensland' then 'QLD'
    when 'new south wales' then 'NSW'
    when 'victoria' then 'VIC'
    when 'western australia' then 'WA'
    when 'south australia' then 'SA'
    when 'australian capital territory' then 'ACT'
    when 'tasmania' then 'TAS'
    when 'northern territory' then 'NT'
    else upper(trim(p_state)) end
$function$
;

CREATE OR REPLACE FUNCTION public.ppl_postcodes_within(p_lat double precision, p_lng double precision, p_km double precision)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(distinct postcode order by postcode), '{}')
  from public.au_postcode_points
  where lat between p_lat - p_km / 111.0 and p_lat + p_km / 111.0
    and lng between p_lng - p_km / (111.0 * cos(radians(p_lat))) and p_lng + p_km / (111.0 * cos(radians(p_lat)))
    and 2 * 6371 * asin(sqrt(
          power(sin(radians(lat::double precision - p_lat) / 2), 2) +
          cos(radians(p_lat)) * cos(radians(lat::double precision)) *
          power(sin(radians(lng::double precision - p_lng) / 2), 2)
        )) <= p_km
$function$
;

CREATE OR REPLACE FUNCTION public.provision_agency_keys()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_twilio_sid_id uuid;
  v_twilio_auth_id uuid;
  v_openai_id uuid;
begin
  if new.user_type != 'internal' then
    return new;
  end if;

  select id into v_twilio_sid_id from vault.secrets where name = 'agency_twilio_sid' limit 1;
  select id into v_twilio_auth_id from vault.secrets where name = 'agency_twilio_auth' limit 1;
  select id into v_openai_id from vault.secrets where name = 'agency_openai_key' limit 1;

  if v_twilio_sid_id is not null then
    insert into public.agency_key_mappings (company_id, provider, vault_secret_id, label)
    values (new.company_id, 'twilio', v_twilio_sid_id, 'Agency Twilio SID')
    on conflict (company_id, provider, label) do nothing;
  end if;

  if v_twilio_auth_id is not null then
    insert into public.agency_key_mappings (company_id, provider, vault_secret_id, label)
    values (new.company_id, 'twilio_auth', v_twilio_auth_id, 'Agency Twilio Auth')
    on conflict (company_id, provider, label) do nothing;
  end if;

  if v_openai_id is not null then
    insert into public.agency_key_mappings (company_id, provider, vault_secret_id, label)
    values (new.company_id, 'openai', v_openai_id, 'Agency OpenAI Key')
    on conflict (company_id, provider, label) do nothing;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.provision_sms_for_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.sms_credits (
    company_id,
    balance,
    monthly_free_sms,
    next_reset_at
  )
  values (
    new.id,
    500,
    500,
    now() + interval '30 days'
  )
  on conflict (company_id) do nothing;

  insert into public.sms_agent_config (
    company_id,
    name,
    auto_reply,
    is_active,
    lead_scoring_enabled
  )
  values (
    new.id,
    'Default SMS Agent',
    false,
    false,
    false
  )
  on conflict do nothing;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.recalc_company_fulfilment(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stage      text;
  v_stage_at   timestamptz;
  v_active     text;
  v_done       int;
  v_settled    int;
  v_total      int;
  v_blocked    int;
  v_next_key   text;
  v_next_sla   int;
  v_next_from  timestamptz;
BEGIN
  SELECT d.mc_sub_stage, cf.completed_at
    INTO v_stage, v_stage_at
    FROM public.company_fulfilment cf
    JOIN public.fulfilment_step_defs d ON d.step_key = cf.step_key
   WHERE cf.company_id = p_company_id
     AND cf.status IN ('done','skipped')
     AND d.active
     AND d.mc_sub_stage IS NOT NULL
   ORDER BY d.sort_order DESC
   LIMIT 1;

  SELECT d.mc_active_status
    INTO v_active
    FROM public.company_fulfilment cf
    JOIN public.fulfilment_step_defs d ON d.step_key = cf.step_key
   WHERE cf.company_id = p_company_id
     AND cf.status = 'done'
     AND d.active
     AND d.mc_active_status IS NOT NULL
   ORDER BY d.sort_order DESC
   LIMIT 1;

  SELECT count(*) INTO v_done
    FROM public.company_fulfilment cf
    JOIN public.fulfilment_step_defs d ON d.step_key = cf.step_key
   WHERE cf.company_id = p_company_id AND cf.status = 'done' AND d.active AND d.required;

  SELECT count(*) INTO v_settled
    FROM public.company_fulfilment cf
    JOIN public.fulfilment_step_defs d ON d.step_key = cf.step_key
   WHERE cf.company_id = p_company_id AND cf.status IN ('done','skipped') AND d.active AND d.required;

  SELECT count(*) INTO v_total
    FROM public.fulfilment_step_defs d
   WHERE d.active AND d.required;

  SELECT count(*) INTO v_blocked
    FROM public.company_fulfilment cf
    JOIN public.fulfilment_step_defs d ON d.step_key = cf.step_key
   WHERE cf.company_id = p_company_id AND cf.status = 'blocked' AND d.active;

  -- Next required step still outstanding, and when it falls due: its SLA runs
  -- from whenever the previous step landed, or from signup if none has.
  SELECT d.step_key, d.sla_hours
    INTO v_next_key, v_next_sla
    FROM public.fulfilment_step_defs d
    LEFT JOIN public.company_fulfilment cf
           ON cf.step_key = d.step_key AND cf.company_id = p_company_id
   WHERE d.active AND d.required
     AND coalesce(cf.status, 'pending') NOT IN ('done','skipped')
   ORDER BY d.sort_order
   LIMIT 1;

  IF v_next_key IS NOT NULL THEN
    SELECT coalesce(max(cf.completed_at), (SELECT c.created_at FROM public.companies c WHERE c.id = p_company_id))
      INTO v_next_from
      FROM public.company_fulfilment cf
     WHERE cf.company_id = p_company_id AND cf.status IN ('done','skipped');
  END IF;

  INSERT INTO public.company_fulfilment_summary
    (company_id, stage, stage_at, active_status, steps_done, steps_settled, steps_total,
     blocked_count, next_step_key, next_step_due, updated_at)
  VALUES
    (p_company_id, v_stage, v_stage_at, v_active, coalesce(v_done,0), coalesce(v_settled,0),
     coalesce(v_total,0), coalesce(v_blocked,0), v_next_key,
     CASE WHEN v_next_key IS NOT NULL AND v_next_sla IS NOT NULL
          THEN v_next_from + make_interval(hours => v_next_sla) END,
     now())
  ON CONFLICT (company_id) DO UPDATE
    SET stage         = EXCLUDED.stage,
        stage_at      = EXCLUDED.stage_at,
        active_status = EXCLUDED.active_status,
        steps_done    = EXCLUDED.steps_done,
        steps_settled = EXCLUDED.steps_settled,
        steps_total   = EXCLUDED.steps_total,
        blocked_count = EXCLUDED.blocked_count,
        next_step_key = EXCLUDED.next_step_key,
        next_step_due = EXCLUDED.next_step_due,
        updated_at    = now();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.record_ppl_area_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.ppl_agreed_postcodes is not null
       and array_length(new.ppl_agreed_postcodes, 1) > 0 then
      insert into public.ppl_area_history (company_id, postcodes, effective_from)
      values (new.id, new.ppl_agreed_postcodes, coalesce(new.created_at, now()));
    end if;

  elsif tg_op = 'UPDATE' then
    if new.ppl_agreed_postcodes is distinct from old.ppl_agreed_postcodes then
      -- close whatever period is currently open
      update public.ppl_area_history
        set effective_to = now()
        where company_id = new.id and effective_to is null;
      -- open a new period for the new set (skip if they cleared it)
      if new.ppl_agreed_postcodes is not null
         and array_length(new.ppl_agreed_postcodes, 1) > 0 then
        insert into public.ppl_area_history (company_id, postcodes, effective_from)
        values (new.id, new.ppl_agreed_postcodes, now());
      end if;
    end if;
  end if;

  return new;
exception when others then
  -- Never let history logging block a company write.
  raise warning 'record_ppl_area_change failed for company %: %', new.id, sqlerrm;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_niche_benchmarks()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  last_update timestamptz;
  min_leads_per_business constant int := 10;
  min_businesses_niche   constant int := 10;
  min_businesses_all     constant int := 5;
begin
  select max(updated_at) into last_update from niche_benchmarks;

  -- Throttle: skip if refreshed within the last 6 hours
  if last_update is not null and last_update > now() - interval '6 hours' then
    return;
  end if;

  insert into niche_benchmarks (
    niche, company_count, ai_leads_analysed,
    avg_callback_rate, p25_callback_rate, p75_callback_rate,
    avg_reply_rate,    p25_reply_rate,    p75_reply_rate,
    avg_lead_score, updated_at
  )
  with eligible as (
    select
      co.id,
      lower(trim(co.name)) as business_key,
      coalesce(
        nullif(lower(regexp_replace(trim(co.niche), '[^a-zA-Z0-9]+', '_', 'g')), ''),
        (select o.niche from ppl_lead_orders o
          where o.company_id = co.id and o.status in ('paid','active','fulfilled')
          group by o.niche order by count(*) desc limit 1)
      ) as niche
    from companies co
    where coalesce((co.settings->>'allow_ai_training')::boolean, true)
      and not coalesce((co.settings->>'exclude_from_benchmarks')::boolean, false)
      and co.name is not null
  ),
  per_business as (
    select
      e.business_key,
      (array_agg(e.niche) filter (where e.niche is not null))[1]           as niche,
      count(*)::int                                                         as ai_leads,
      case when bool_and(al.callback_mode)
        then 100.0 * count(*) filter (where al.callback_booked) / count(*) end as callback_rate,
      100.0 * count(*) filter (where al.replied) / count(*)                 as reply_rate,
      case when count(*) filter (where al.ai_score > 0) >= 5
        then avg(al.ai_score) filter (where al.ai_score > 0) end            as lead_score
    from ai_live_leads() al
    join eligible e on e.id = al.company_id
    group by e.business_key
    having count(*) >= min_leads_per_business
  )
  select
    g.niche,
    count(*)::int,
    sum(b.ai_leads)::int,
    round(avg(b.callback_rate)::numeric, 2),
    round(percentile_cont(0.25) within group (order by b.callback_rate)::numeric, 2),
    round(percentile_cont(0.75) within group (order by b.callback_rate)::numeric, 2),
    round(avg(b.reply_rate)::numeric, 2),
    round(percentile_cont(0.25) within group (order by b.reply_rate)::numeric, 2),
    round(percentile_cont(0.75) within group (order by b.reply_rate)::numeric, 2),
    round(avg(b.lead_score)::numeric, 1),
    now()
  from per_business b
  cross join lateral (values (b.niche), ('_all')) g(niche)
  where g.niche is not null
  group by g.niche
  having count(*) >= case when g.niche = '_all' then min_businesses_all else min_businesses_niche end
  on conflict (niche) do update set
    company_count     = excluded.company_count,
    ai_leads_analysed = excluded.ai_leads_analysed,
    avg_callback_rate = excluded.avg_callback_rate,
    p25_callback_rate = excluded.p25_callback_rate,
    p75_callback_rate = excluded.p75_callback_rate,
    avg_reply_rate    = excluded.avg_reply_rate,
    p25_reply_rate    = excluded.p25_reply_rate,
    p75_reply_rate    = excluded.p75_reply_rate,
    avg_lead_score    = excluded.avg_lead_score,
    updated_at        = excluded.updated_at;

  -- Rows not refreshed this run no longer meet their threshold; zero them so
  -- the dashboard ignores them (it requires company_count >= threshold).
  update niche_benchmarks
     set company_count = 0
   where updated_at < now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refund_sms_credit(p_company_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.sms_credits
    set balance = balance + 1,
        lifetime_used = greatest(lifetime_used - 1, 0),
        updated_at = now()
    where company_id = p_company_id;

  return found;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reset_monthly_sms_credits()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.sms_credits
    set balance = balance + monthly_free_sms,
        next_reset_at = next_reset_at + interval '30 days',
        updated_at = now()
  where next_reset_at is not null
    and next_reset_at <= now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_api_key(p_company_id uuid, p_provider api_key_provider)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_user_type public.user_type;
  v_encrypted bytea;
  v_vault_id  uuid;
  v_key       text;
begin
  -- Determine company's user type from the first profile (company-level setting)
  select user_type into v_user_type
    from public.profiles
    where company_id = p_company_id
    limit 1;

  if v_user_type = 'external' then
    -- External: decrypt from api_keys
    select encrypted_key into v_encrypted
      from public.api_keys
      where company_id = p_company_id
        and provider = p_provider
        and is_active = true
      limit 1;

    if v_encrypted is null then
      raise exception 'No active % key found for company %', p_provider, p_company_id;
    end if;

    return public.decrypt_api_key(v_encrypted, p_company_id);

  else
    -- Internal: fetch from Vault via agency_key_mappings
    select vault_secret_id into v_vault_id
      from public.agency_key_mappings
      where company_id = p_company_id
        and provider = p_provider
        and is_active = true
      limit 1;

    if v_vault_id is null then
      raise exception 'No agency key mapping for % / company %', p_provider, p_company_id;
    end if;

    select decrypted_secret into v_key
      from vault.decrypted_secrets
      where id = v_vault_id;

    return v_key;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_shared_number_owner(p_company_ids uuid[], p_phones text[])
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with latest as (
    select l.company_id, max(m.created_at) as last_outbound
    from public.leads l
    join public.conversations c on c.lead_id = l.id and c.company_id = l.company_id
    join public.messages m on m.conversation_id = c.id and m.direction = 'outbound'
    where l.company_id = any(p_company_ids)
      and l.phone = any(p_phones)
    group by l.company_id
  ),
  ranked as (
    select company_id, last_outbound,
           rank() over (order by last_outbound desc) as rnk,
           count(*) over () as n
    from latest
  )
  -- One clear winner only. A tie on the exact same timestamp resolves to NULL
  -- rather than to whichever row the planner happened to return first.
  select company_id from ranked
  where rnk = 1
    and (select count(*) from ranked where rnk = 1) = 1
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.route_lead(p_company_id uuid, p_postcode text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_settings   jsonb;
  v_routing    jsonb;
  v_mode       text;
  v_reps       uuid[];
  v_count      int;
  v_idx        int;
  v_next_rep   uuid;
  v_rules      jsonb;
  v_rule       jsonb;
  v_postcodes  jsonb;
  v_pc         text;
  i            int;
  j            int;
begin
  select settings into v_settings from public.companies where id = p_company_id;
  v_routing := v_settings->'lead_routing';

  if v_routing is null then
    return null; -- no routing configured → everyone sees it
  end if;

  v_mode := v_routing->>'mode';

  -- Mode: all — no assignment
  if v_mode is null or v_mode = 'all' then
    return null;
  end if;

  -- Get active reps
  select array_agg(user_id order by created_at)
  into v_reps
  from public.sales_reps
  where company_id = p_company_id and is_active = true;

  v_count := coalesce(array_length(v_reps, 1), 0);
  if v_count = 0 then
    return null; -- no reps → unassigned
  end if;

  -- Mode: round_robin
  if v_mode = 'round_robin' then
    v_idx := coalesce((v_routing->>'round_robin_index')::int, 0);
    v_next_rep := v_reps[(v_idx % v_count) + 1];  -- 1-indexed array

    -- Increment the index
    update public.companies
    set settings = jsonb_set(
      coalesce(settings, '{}'),
      '{lead_routing,round_robin_index}',
      to_jsonb((v_idx + 1) % v_count)
    )
    where id = p_company_id;

    return v_next_rep;
  end if;

  -- Mode: postcode
  if v_mode = 'postcode' and p_postcode is not null then
    v_rules := v_routing->'postcode_rules';
    if v_rules is not null and jsonb_array_length(v_rules) > 0 then
      for i in 0 .. jsonb_array_length(v_rules) - 1 loop
        v_rule := v_rules->i;
        v_postcodes := v_rule->'postcodes';
        if v_postcodes is not null then
          for j in 0 .. jsonb_array_length(v_postcodes) - 1 loop
            v_pc := v_postcodes->>j;
            -- Exact match or range match (e.g. "2000-2050")
            if v_pc = p_postcode then
              return (v_rule->>'rep_id')::uuid;
            elsif v_pc like '%-%' then
              -- Range: "2000-2050" — use numeric comparison for safety
              declare
                v_lo text := split_part(v_pc, '-', 1);
                v_hi text := split_part(v_pc, '-', 2);
              begin
                if lpad(p_postcode, 10, '0') >= lpad(v_lo, 10, '0')
                   and lpad(p_postcode, 10, '0') <= lpad(v_hi, 10, '0') then
                  return (v_rule->>'rep_id')::uuid;
                end if;
              end;
            end if;
          end loop;
        end if;
      end loop;
    end if;

    -- No postcode match — fall back to round robin if reps exist
    v_idx := coalesce((v_routing->>'round_robin_index')::int, 0);
    v_next_rep := v_reps[(v_idx % v_count) + 1];
    update public.companies
    set settings = jsonb_set(
      coalesce(settings, '{}'),
      '{lead_routing,round_robin_index}',
      to_jsonb((v_idx + 1) % v_count)
    )
    where id = p_company_id;
    return v_next_rep;
  end if;

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_meta_conversion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.pipeline_stage::text = 'closed_won' and old.pipeline_stage::text is distinct from 'closed_won' then
    perform public.send_meta_event(new.id, 'Purchase');
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_meta_event(p_lead uuid, p_event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from public.leads l join public.companies c on c.id = l.company_id
    where l.id = p_lead and not coalesce(l.is_ppl, false) and c.meta_dataset_id is not null
  ) then
    return;
  end if;
  perform net.http_post(
    url     := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/meta-capi',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-autopilot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_secret')),
    body    := jsonb_build_object('action', 'send', 'lead_id', p_lead, 'event', p_event),
    timeout_milliseconds := 30000
  );
exception
  when others then
    raise warning 'send_meta_event % for %: %', p_event, p_lead, sqlerrm;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_meta_quote_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.lead_id is not null and new.sent_at is not null
     and (tg_op = 'INSERT' or old.sent_at is null) then
    perform public.send_meta_event(new.lead_id, 'QuoteSent');
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_meta_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.lead_id is not null then
    perform public.send_meta_event(new.lead_id, 'Schedule');
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_welcome_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_user_email text;
  v_user_name  text;
  v_supabase_url text := current_setting('app.settings.supabase_url', true);
  v_service_key  text := current_setting('app.settings.service_role_key', true);
begin
  -- Get the user's email from auth.users
  select email into v_user_email
  from auth.users
  where id = new.id;

  -- Get the user's name
  v_user_name := coalesce(new.full_name, 'there');

  -- Only send welcome email to owners (new sign-ups), not invited members
  if new.role = 'owner' and v_user_email is not null then
    -- Use pg_net to call the resend-email edge function asynchronously
    -- This is non-blocking and won't slow down the sign-up process
    perform net.http_post(
      url := coalesce(v_supabase_url, '') || '/functions/v1/resend-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(v_service_key, '')
      ),
      body := jsonb_build_object(
        'to', v_user_email,
        'subject', 'Welcome to QuoteLeadsHQ!',
        'html', '<html><body style="margin:0;padding:0;background:#f3f5f9;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:40px 20px"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08)"><tr><td style="background:#1f6fff;padding:24px 32px"><h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600">QuoteLeadsHQ</h1></td></tr><tr><td style="padding:32px"><h2 style="margin:0 0 16px;font-size:18px;color:#111827">Welcome to QuoteLeadsHQ!</h2><p style="margin:0 0 8px;font-size:14px;color:#374151">Hi ' || v_user_name || ',</p><p style="margin:0 0 16px;font-size:14px;color:#374151">Your account has been created. You can now log in to manage your leads, quotes, and appointments with AI-powered automation.</p></td></tr><tr><td style="padding:16px 32px;background:#f8f9fb;border-top:1px solid #e5e7eb"><p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">QuoteLeadsHQ. All rights reserved.</p></td></tr></table></td></tr></table></body></html>'
      )
    );
  end if;

  return new;
exception
  when others then
    -- Never fail the trigger — email is best-effort
    raise warning 'send_welcome_email failed: %', sqlerrm;
    return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_company_capi_token(p_company uuid, p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secret uuid;
begin
  select secret_id into v_secret from public.company_capi_tokens where company_id = p_company;
  if v_secret is null then
    v_secret := vault.create_secret(coalesce(p_token, ''), 'capi_token_' || p_company::text);
    insert into public.company_capi_tokens (company_id, secret_id) values (p_company, v_secret);
  else
    perform vault.update_secret(v_secret, coalesce(p_token, ''));
    update public.company_capi_tokens set updated_at = now() where company_id = p_company;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sms_is_opted_out(p_company_id uuid, p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
           select 1 from public.sms_opt_outs o
            where o.company_id = p_company_id
              and o.phone = public.norm_au_phone(p_phone)
              and o.opted_out
         )
      or exists (
           select 1 from public.leads l
            where l.company_id = p_company_id
              and l.sms_opted_out = true
              and public.norm_au_phone(l.phone) = public.norm_au_phone(p_phone)
         )
$function$
;

CREATE OR REPLACE FUNCTION public.sms_set_opt_out(p_company_id uuid, p_phone text, p_opted_out boolean, p_source text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phone text := public.norm_au_phone(p_phone);
begin
  if p_company_id is null or v_phone is null or v_phone = '' then
    return;
  end if;
  insert into public.sms_opt_outs (company_id, phone, opted_out, source, updated_at)
  values (p_company_id, v_phone, p_opted_out, p_source, now())
  on conflict (company_id, phone)
  do update set opted_out = excluded.opted_out, source = excluded.source, updated_at = now();

  update public.leads
     set sms_opted_out    = p_opted_out,
         sms_opted_out_at = case when p_opted_out then now() else null end
   where company_id = p_company_id
     and public.norm_au_phone(phone) = v_phone
     and sms_opted_out is distinct from p_opted_out;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_is_ppl_from_source()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  NEW.is_ppl := coalesce(lower(NEW.source) in ('ppl', 'quoteleads ppl'), false);
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_lead_name()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.first_name IS NULL OR NEW.first_name = '' THEN
    NEW.first_name := split_part(COALESCE(NEW.name, 'Unknown'), ' ', 1);
  END IF;
  IF NEW.last_name IS NULL OR NEW.last_name = '' THEN
    NEW.last_name := NULLIF(trim(substring(COALESCE(NEW.name, '') FROM position(' ' IN COALESCE(NEW.name, '')) + 1)), '');
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tick_first_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  prev text;
begin
  if new.company_id is null then return new; end if;
  if not exists (select 1 from companies where id = new.company_id and plan = 'managed') then return new; end if;
  select status into prev from company_fulfilment where company_id = new.company_id and step_key = 'first_lead';
  if prev in ('done', 'skipped') then return new; end if;

  insert into company_fulfilment (company_id, step_key, status, completed_at, completed_by_name, notes)
  values (new.company_id, 'first_lead', 'done', now(), 'Automation',
          left('First lead: ' || coalesce(new.source, 'unknown source'), 2000))
  on conflict (company_id, step_key) do update
    set status = 'done', completed_at = now(), completed_by = null, completed_by_name = 'Automation',
        notes = excluded.notes;

  insert into fulfilment_log (company_id, actor_id, actor_name, action, step_key, from_status, to_status, detail)
  values (new.company_id, null, 'Automation', 'fulfilment.step_set', 'first_lead', coalesce(prev, 'pending'), 'done',
          jsonb_build_object('notes', 'First lead arrived', 'lead_id', new.id));
  return new;
exception when others then
  raise warning 'tick_first_lead: %', sqlerrm;
  return new;
end $function$
;


-- ===== Foreign keys =====
alter table public.activity_log add constraint activity_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.activity_log add constraint activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.agency_key_mappings add constraint agency_key_mappings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.ai_performance_stats add constraint ai_performance_stats_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.ai_workflow_runs add constraint ai_workflow_runs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.ai_workflow_runs add constraint ai_workflow_runs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;
alter table public.ai_workflow_runs add constraint ai_workflow_runs_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
alter table public.ai_workflow_runs add constraint ai_workflow_runs_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL;
alter table public.api_keys add constraint api_keys_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.api_keys add constraint api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.appointments add constraint appointments_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.appointments add constraint appointments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.appointments add constraint appointments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
alter table public.call_log add constraint call_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.call_log add constraint call_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
alter table public.campaign_builds add constraint campaign_builds_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.campaign_builds add constraint campaign_builds_round_id_fkey FOREIGN KEY (round_id) REFERENCES creative_rounds(id) ON DELETE SET NULL;
alter table public.client_email_log add constraint client_email_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.client_notes add constraint client_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.client_notes add constraint client_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.client_reminders add constraint client_reminders_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.company_api_tokens add constraint company_api_tokens_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.company_assets add constraint company_assets_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.company_assets add constraint company_assets_stock_asset_id_fkey FOREIGN KEY (stock_asset_id) REFERENCES stock_assets(id) ON DELETE CASCADE;
alter table public.company_capi_tokens add constraint company_capi_tokens_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.company_fulfilment add constraint company_fulfilment_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.company_fulfilment add constraint company_fulfilment_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.company_fulfilment add constraint company_fulfilment_step_key_fkey FOREIGN KEY (step_key) REFERENCES fulfilment_step_defs(step_key);
alter table public.company_fulfilment_summary add constraint company_fulfilment_summary_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.company_knowledge add constraint company_knowledge_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.company_knowledge add constraint company_knowledge_source_lead_id_fkey FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON DELETE SET NULL;
alter table public.conversations add constraint conversations_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.conversations add constraint conversations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.conversations add constraint conversations_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
alter table public.conversations add constraint conversations_sms_config_id_fkey FOREIGN KEY (sms_config_id) REFERENCES sms_agent_config(id) ON DELETE SET NULL;
alter table public.creative_rounds add constraint creative_rounds_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.custom_fields add constraint custom_fields_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.fulfilment_log add constraint fulfilment_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.invoices add constraint invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
alter table public.lead_custom_field_values add constraint lead_custom_field_values_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.lead_custom_field_values add constraint lead_custom_field_values_custom_field_id_fkey FOREIGN KEY (custom_field_id) REFERENCES custom_fields(id) ON DELETE CASCADE;
alter table public.lead_custom_field_values add constraint lead_custom_field_values_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
alter table public.lead_disputes add constraint lead_disputes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.lead_disputes add constraint lead_disputes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
alter table public.lead_disputes add constraint lead_disputes_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.lead_disputes add constraint lead_disputes_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.lead_notification_log add constraint lead_notification_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.lead_notification_log add constraint lead_notification_log_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
alter table public.lead_notification_log add constraint lead_notification_log_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.leads add constraint leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.leads add constraint leads_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.media_uploads add constraint media_uploads_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.meta_assets add constraint meta_assets_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
alter table public.meta_capi_events add constraint meta_capi_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.meta_capi_events add constraint meta_capi_events_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
alter table public.meta_connections add constraint meta_connections_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.meta_connections add constraint meta_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.meta_leads add constraint meta_leads_build_id_fkey FOREIGN KEY (build_id) REFERENCES campaign_builds(id) ON DELETE SET NULL;
alter table public.meta_leads add constraint meta_leads_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.notifications add constraint notifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.notifications add constraint notifications_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
alter table public.onboarding_submissions add constraint onboarding_submissions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
alter table public.password_reset_tokens add constraint password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.ppl_area_change_requests add constraint ppl_area_change_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.ppl_area_history add constraint ppl_area_history_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.ppl_call_attempts add constraint ppl_call_attempts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.ppl_call_attempts add constraint ppl_call_attempts_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
alter table public.ppl_call_attempts add constraint ppl_call_attempts_logged_by_fkey FOREIGN KEY (logged_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.ppl_lead_orders add constraint ppl_lead_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.ppl_orders add constraint ppl_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.preview_links add constraint preview_links_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.quote_drafts add constraint quote_drafts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.quote_drafts add constraint quote_drafts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;
alter table public.quote_drafts add constraint quote_drafts_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
alter table public.quote_drafts add constraint quote_drafts_source_run_id_fkey FOREIGN KEY (source_run_id) REFERENCES ai_workflow_runs(id) ON DELETE SET NULL;
alter table public.quote_followup_queue add constraint quote_followup_queue_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
alter table public.quote_followup_queue add constraint quote_followup_queue_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id);
alter table public.quote_followup_queue add constraint quote_followup_queue_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id);
alter table public.quote_followup_queue add constraint quote_followup_queue_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id);
alter table public.quotes add constraint quotes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.quotes add constraint quotes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.quotes add constraint quotes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
alter table public.review_requests add constraint review_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.review_requests add constraint review_requests_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
alter table public.sales add constraint sales_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.sales add constraint sales_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.sales add constraint sales_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
alter table public.sales add constraint sales_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL;
alter table public.sales_rep_invites add constraint sales_rep_invites_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.sales_rep_invites add constraint sales_rep_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.sales_rep_invites add constraint sales_rep_invites_sales_rep_id_fkey FOREIGN KEY (sales_rep_id) REFERENCES sales_reps(id) ON DELETE SET NULL;
alter table public.sales_reps add constraint sales_reps_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.sales_reps add constraint sales_reps_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.sms_agent_config add constraint sms_agent_config_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.sms_credits add constraint sms_credits_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.team_assignments add constraint va_assignments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.team_assignments add constraint va_assignments_va_user_id_fkey FOREIGN KEY (team_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.team_availability add constraint va_availability_va_user_id_fkey FOREIGN KEY (team_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.team_sms_message add constraint team_sms_message_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.team_sms_message add constraint team_sms_message_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
alter table public.team_sms_message add constraint team_sms_message_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.twilio_numbers add constraint twilio_numbers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.twilio_numbers add constraint twilio_numbers_sms_config_id_fkey FOREIGN KEY (sms_config_id) REFERENCES sms_agent_config(id) ON DELETE SET NULL;
alter table public.voice_agent_config add constraint voice_agent_config_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.voice_calls add constraint voice_calls_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.voice_calls add constraint voice_calls_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.voice_calls add constraint voice_calls_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;
alter table public.voice_calls add constraint voice_calls_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
alter table public.voice_calls add constraint voice_calls_voice_config_id_fkey FOREIGN KEY (voice_config_id) REFERENCES voice_agent_config(id) ON DELETE SET NULL;
alter table public.webhook_deliveries add constraint webhook_deliveries_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.webhook_deliveries add constraint webhook_deliveries_webhook_id_fkey FOREIGN KEY (webhook_id) REFERENCES webhook_endpoints(id) ON DELETE CASCADE;
alter table public.webhook_endpoints add constraint webhook_endpoints_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

-- ===== Indexes =====
CREATE INDEX ai_workflow_runs_company_idx ON public.ai_workflow_runs USING btree (company_id, created_at DESC);
CREATE INDEX au_postcode_points_lat_lng ON public.au_postcode_points USING btree (lat, lng);
CREATE INDEX au_postcode_points_state ON public.au_postcode_points USING btree (state);
CREATE INDEX call_log_actor_idx ON public.call_log USING btree (actor_id, created_at DESC);
CREATE INDEX call_log_company_idx ON public.call_log USING btree (company_id, created_at DESC);
CREATE UNIQUE INDEX campaign_builds_one_live ON public.campaign_builds USING btree (company_id) WHERE (status = ANY (ARRAY['queued'::text, 'building'::text, 'built'::text, 'needs_team'::text]));
CREATE INDEX campaign_builds_status ON public.campaign_builds USING btree (status);
CREATE INDEX client_email_log_company_idx ON public.client_email_log USING btree (company_id, sent_at DESC);
CREATE UNIQUE INDEX companies_management_subscription_id_idx ON public.companies USING btree (management_subscription_id) WHERE (management_subscription_id IS NOT NULL);
CREATE INDEX company_assets_company_idx ON public.company_assets USING btree (company_id, created_at);
CREATE INDEX company_fulfilment_company_idx ON public.company_fulfilment USING btree (company_id);
CREATE INDEX company_fulfilment_status_idx ON public.company_fulfilment USING btree (status);
CREATE INDEX company_fulfilment_summary_due_idx ON public.company_fulfilment_summary USING btree (next_step_due);
CREATE INDEX company_fulfilment_summary_stage_idx ON public.company_fulfilment_summary USING btree (stage);
CREATE INDEX creative_rounds_status_idx ON public.creative_rounds USING btree (status);
CREATE INDEX custom_fields_company_idx ON public.custom_fields USING btree (company_id, entity_type, is_active);
CREATE INDEX email_templates_name_idx ON public.email_templates USING btree (name);
CREATE UNIQUE INDEX email_templates_slug_key ON public.email_templates USING btree (slug) WHERE (slug IS NOT NULL);
CREATE INDEX fulfilment_log_action_idx ON public.fulfilment_log USING btree (action);
CREATE INDEX fulfilment_log_actor_idx ON public.fulfilment_log USING btree (actor_id, created_at DESC);
CREATE INDEX fulfilment_log_company_idx ON public.fulfilment_log USING btree (company_id, created_at DESC);
CREATE INDEX idx_activity_company ON public.activity_log USING btree (company_id, created_at DESC);
CREATE INDEX idx_activity_entity ON public.activity_log USING btree (entity_type, entity_id);
CREATE INDEX idx_agency_keys_company ON public.agency_key_mappings USING btree (company_id);
CREATE INDEX idx_ai_perf_stats_company ON public.ai_performance_stats USING btree (company_id, period, period_start DESC);
CREATE INDEX idx_ai_workflow_runs_company ON public.ai_workflow_runs USING btree (company_id, created_at DESC);
CREATE INDEX idx_api_keys_company ON public.api_keys USING btree (company_id);
CREATE INDEX idx_api_keys_provider ON public.api_keys USING btree (company_id, provider);
CREATE INDEX idx_api_tokens_company ON public.company_api_tokens USING btree (company_id);
CREATE INDEX idx_api_tokens_hash ON public.company_api_tokens USING btree (token_hash);
CREATE INDEX idx_appointments_assigned ON public.appointments USING btree (assigned_to);
CREATE INDEX idx_appointments_company ON public.appointments USING btree (company_id);
CREATE INDEX idx_appointments_start ON public.appointments USING btree (company_id, start_time);
CREATE INDEX idx_appointments_status ON public.appointments USING btree (company_id, status);
CREATE INDEX idx_client_notes_company ON public.client_notes USING btree (company_id, created_at DESC);
CREATE INDEX idx_companies_slug ON public.companies USING btree (slug);
CREATE INDEX idx_company_knowledge_company ON public.company_knowledge USING btree (company_id, is_active, category);
CREATE INDEX idx_company_knowledge_created ON public.company_knowledge USING btree (company_id, created_at DESC);
CREATE INDEX idx_company_knowledge_tags ON public.company_knowledge USING gin (tags);
CREATE INDEX idx_conversations_assigned ON public.conversations USING btree (assigned_to);
CREATE INDEX idx_conversations_company ON public.conversations USING btree (company_id);
CREATE INDEX idx_conversations_lead ON public.conversations USING btree (lead_id);
CREATE INDEX idx_conversations_open ON public.conversations USING btree (company_id, is_open);
CREATE INDEX idx_conversations_sms_config ON public.conversations USING btree (sms_config_id);
CREATE INDEX idx_custom_fields_company ON public.custom_fields USING btree (company_id);
CREATE INDEX idx_industry_insights_industry ON public.industry_insights USING btree (industry, is_active);
CREATE INDEX idx_lead_disputes_company ON public.lead_disputes USING btree (company_id, created_at DESC);
CREATE INDEX idx_lead_disputes_lead ON public.lead_disputes USING btree (lead_id);
CREATE INDEX idx_lead_disputes_status ON public.lead_disputes USING btree (company_id, status);
CREATE INDEX idx_lead_notification_log_company ON public.lead_notification_log USING btree (company_id, created_at DESC);
CREATE INDEX idx_leads_assigned ON public.leads USING btree (assigned_to);
CREATE INDEX idx_leads_company ON public.leads USING btree (company_id);
CREATE INDEX idx_leads_created ON public.leads USING btree (company_id, created_at DESC);
CREATE INDEX idx_leads_is_ppl ON public.leads USING btree (company_id, is_ppl) WHERE (is_ppl = true);
CREATE INDEX idx_leads_phone ON public.leads USING btree (company_id, phone);
CREATE INDEX idx_leads_pipeline ON public.leads USING btree (company_id, pipeline_stage);
CREATE INDEX idx_leads_pipeline_pos ON public.leads USING btree (company_id, pipeline_stage, pipeline_position);
CREATE INDEX idx_leads_ppl_scrubbed ON public.leads USING btree (company_id) WHERE (ppl_scrubbed = true);
CREATE INDEX idx_leads_sms_opted_out ON public.leads USING btree (sms_opted_out) WHERE sms_opted_out;
CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id, created_at);
CREATE INDEX idx_notifications_company ON public.notifications USING btree (company_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON public.notifications USING btree (company_id, is_read) WHERE (is_read = false);
CREATE INDEX idx_ppl_area_history_company ON public.ppl_area_history USING btree (company_id, effective_from DESC);
CREATE INDEX idx_ppl_call_attempts_company ON public.ppl_call_attempts USING btree (company_id, created_at DESC);
CREATE INDEX idx_ppl_call_attempts_lead ON public.ppl_call_attempts USING btree (lead_id, attempted_at);
CREATE INDEX idx_ppl_orders_active ON public.ppl_orders USING btree (company_id, status) WHERE (status = 'active'::text);
CREATE INDEX idx_ppl_orders_company ON public.ppl_orders USING btree (company_id, purchased_at DESC);
CREATE INDEX idx_profiles_company ON public.profiles USING btree (company_id);
CREATE INDEX idx_profiles_deletion_token ON public.profiles USING btree (deletion_token) WHERE (deletion_token IS NOT NULL);
CREATE INDEX idx_profiles_inactive ON public.profiles USING btree (inactive_marked_at) WHERE (inactive_marked_at IS NOT NULL);
CREATE INDEX idx_profiles_is_admin ON public.profiles USING btree (is_admin) WHERE (is_admin = true);
CREATE INDEX idx_profiles_user_type ON public.profiles USING btree (user_type);
CREATE INDEX idx_prt_expires_at ON public.password_reset_tokens USING btree (expires_at);
CREATE INDEX idx_prt_token_hash ON public.password_reset_tokens USING btree (token_hash);
CREATE INDEX idx_quotes_company ON public.quotes USING btree (company_id);
CREATE INDEX idx_quotes_lead ON public.quotes USING btree (lead_id);
CREATE INDEX idx_quotes_status ON public.quotes USING btree (company_id, status);
CREATE INDEX idx_review_requests_company ON public.review_requests USING btree (company_id);
CREATE INDEX idx_review_requests_lead ON public.review_requests USING btree (lead_id);
CREATE UNIQUE INDEX idx_review_requests_lead_unique ON public.review_requests USING btree (lead_id) WHERE (status = ANY (ARRAY['pending'::text, 'sent'::text]));
CREATE INDEX idx_review_requests_scheduled ON public.review_requests USING btree (status, scheduled_at);
CREATE INDEX idx_review_requests_status ON public.review_requests USING btree (company_id, status);
CREATE INDEX idx_sales_closed_at ON public.sales USING btree (company_id, closed_at DESC);
CREATE INDEX idx_sales_company ON public.sales USING btree (company_id);
CREATE INDEX idx_sales_rep_invites_company ON public.sales_rep_invites USING btree (company_id, status);
CREATE INDEX idx_sales_reps_company ON public.sales_reps USING btree (company_id);
CREATE INDEX idx_sales_reps_user ON public.sales_reps USING btree (user_id);
CREATE INDEX idx_sales_status ON public.sales USING btree (company_id, status);
CREATE INDEX idx_sms_agent_company ON public.sms_agent_config USING btree (company_id);
CREATE INDEX idx_sms_agent_twilio_number ON public.sms_agent_config USING btree (twilio_number);
CREATE INDEX idx_sms_credits_company ON public.sms_credits USING btree (company_id);
CREATE INDEX idx_team_assignments_company ON public.team_assignments USING btree (company_id);
CREATE INDEX idx_team_assignments_user ON public.team_assignments USING btree (team_user_id);
CREATE INDEX idx_twilio_numbers_company ON public.twilio_numbers USING btree (company_id);
CREATE INDEX idx_voice_agent_company ON public.voice_agent_config USING btree (company_id);
CREATE INDEX idx_voice_calls_company ON public.voice_calls USING btree (company_id);
CREATE INDEX idx_voice_calls_conversation ON public.voice_calls USING btree (conversation_id);
CREATE INDEX idx_voice_calls_created ON public.voice_calls USING btree (company_id, created_at DESC);
CREATE INDEX idx_voice_calls_lead ON public.voice_calls USING btree (lead_id);
CREATE INDEX idx_voice_calls_status ON public.voice_calls USING btree (company_id, status);
CREATE INDEX idx_voice_calls_vapi_call ON public.voice_calls USING btree (vapi_call_id);
CREATE INDEX idx_webhook_deliveries_company ON public.webhook_deliveries USING btree (company_id);
CREATE INDEX idx_webhook_deliveries_webhook ON public.webhook_deliveries USING btree (webhook_id);
CREATE INDEX idx_webhook_endpoints_company ON public.webhook_endpoints USING btree (company_id);
CREATE INDEX invoices_company_id_idx ON public.invoices USING btree (company_id);
CREATE INDEX invoices_created_idx ON public.invoices USING btree (created_at DESC);
CREATE INDEX invoices_status_idx ON public.invoices USING btree (status);
CREATE INDEX lead_custom_field_values_lead_idx ON public.lead_custom_field_values USING btree (lead_id);
CREATE INDEX leads_company_phone_idx ON public.leads USING btree (company_id, phone);
CREATE INDEX leads_company_pipeline_stage_idx ON public.leads USING btree (company_id, pipeline_stage);
CREATE INDEX media_uploads_company_idx ON public.media_uploads USING btree (company_id, created_at);
CREATE INDEX media_uploads_open_idx ON public.media_uploads USING btree (created_at) WHERE (finished_at IS NULL);
CREATE INDEX meta_assets_company ON public.meta_assets USING btree (company_id);
CREATE INDEX meta_capi_events_company ON public.meta_capi_events USING btree (company_id, created_at DESC);
CREATE INDEX meta_capi_events_unsent ON public.meta_capi_events USING btree (created_at) WHERE (sent_at IS NULL);
CREATE INDEX meta_leads_company ON public.meta_leads USING btree (company_id, created_at DESC);
CREATE INDEX meta_leads_undelivered ON public.meta_leads USING btree (created_at) WHERE (lead_id IS NULL);
CREATE INDEX onboarding_submissions_company_idx ON public.onboarding_submissions USING btree (company_id);
CREATE INDEX onboarding_submissions_email_idx ON public.onboarding_submissions USING btree (lower(email));
CREATE INDEX onboarding_submissions_gate_idx ON public.onboarding_submissions USING btree (gate_status, created_at DESC);
CREATE UNIQUE INDEX onboarding_submissions_open_email_uniq ON public.onboarding_submissions USING btree (lower(email)) WHERE ((gate_status = ANY (ARRAY['pending'::text, 'held'::text, 'matched'::text, 'approved'::text])) AND (company_id IS NULL));
CREATE INDEX onboarding_submissions_phone_idx ON public.onboarding_submissions USING btree (phone_e164);
CREATE INDEX ppl_lead_orders_postcodes ON public.ppl_lead_orders USING gin (postcodes);
CREATE UNIQUE INDEX ppl_pricing_niche_subniche_area_idx ON public.ppl_pricing USING btree (niche, COALESCE(sub_niche, ''::text), area) WHERE (area IS NOT NULL);
CREATE UNIQUE INDEX ppl_pricing_niche_subniche_default_idx ON public.ppl_pricing USING btree (niche, COALESCE(sub_niche, ''::text)) WHERE (area IS NULL);
CREATE INDEX preview_links_company_idx ON public.preview_links USING btree (company_id, created_at DESC);
CREATE INDEX sales_rep_invites_company_status_idx ON public.sales_rep_invites USING btree (company_id, status, invited_at DESC);
CREATE INDEX stock_assets_trades_idx ON public.stock_assets USING gin (trades);
CREATE INDEX team_sms_company_idx ON public.team_sms_message USING btree (company_id, created_at DESC);
CREATE INDEX team_sms_from_idx ON public.team_sms_message USING btree (from_number, created_at DESC);
CREATE INDEX team_sms_unread_idx ON public.team_sms_message USING btree (created_at DESC) WHERE ((direction = 'inbound'::text) AND (read_at IS NULL));
CREATE INDEX twilio_numbers_company_idx ON public.twilio_numbers USING btree (company_id, is_active);

-- ===== Triggers =====
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.agency_key_mappings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_send_meta_schedule AFTER INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION send_meta_schedule();
CREATE TRIGGER auto_provision_sms AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION provision_sms_for_company();
CREATE TRIGGER auto_provision_sms_shared_number AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION assign_shared_number_to_company();
CREATE TRIGGER on_company_ppl_area_change AFTER INSERT OR UPDATE OF ppl_agreed_postcodes ON public.companies FOR EACH ROW EXECUTE FUNCTION record_ppl_area_change();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER company_fulfilment_recalc_trg AFTER INSERT OR DELETE OR UPDATE ON public.company_fulfilment FOR EACH ROW EXECUTE FUNCTION company_fulfilment_recalc();
CREATE TRIGGER company_fulfilment_touch_trg BEFORE INSERT OR UPDATE ON public.company_fulfilment FOR EACH ROW EXECUTE FUNCTION company_fulfilment_touch();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.custom_fields FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lead_custom_field_values FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_lead_disputes_updated_at BEFORE UPDATE ON public.lead_disputes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER lead_name_sync BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION sync_lead_name();
CREATE TRIGGER on_lead_created_notify AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION notify_new_lead();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_leads_normalise_phone BEFORE INSERT OR UPDATE OF phone ON public.leads FOR EACH ROW EXECUTE FUNCTION leads_normalise_phone();
CREATE TRIGGER trg_ppl_order_delivered AFTER INSERT OR UPDATE OF is_ppl ON public.leads FOR EACH ROW EXECUTE FUNCTION increment_ppl_order_delivered();
CREATE TRIGGER trg_send_meta_conversion AFTER UPDATE OF pipeline_stage ON public.leads FOR EACH ROW EXECUTE FUNCTION send_meta_conversion();
CREATE TRIGGER trg_sync_is_ppl_from_source BEFORE INSERT OR UPDATE OF source ON public.leads FOR EACH ROW EXECUTE FUNCTION sync_is_ppl_from_source();
CREATE TRIGGER trg_tick_first_lead AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION tick_first_lead();
CREATE TRIGGER zz_enforce_ppl_lead_lock BEFORE DELETE OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION enforce_ppl_lead_lock();
CREATE TRIGGER onboarding_submissions_touch_trg BEFORE UPDATE ON public.onboarding_submissions FOR EACH ROW EXECUTE FUNCTION onboarding_submissions_touch();
CREATE TRIGGER trg_cleanup_expired_reset_tokens AFTER INSERT ON public.password_reset_tokens FOR EACH STATEMENT EXECUTE FUNCTION cleanup_expired_reset_tokens();
CREATE TRIGGER on_ppl_area_change_request_notify AFTER INSERT ON public.ppl_area_change_requests FOR EACH ROW EXECUTE FUNCTION notify_ppl_area_change_request();
CREATE TRIGGER trg_ppl_orders_updated_at BEFORE UPDATE ON public.ppl_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER auto_provision_agency_keys AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION provision_agency_keys();
CREATE TRIGGER on_profile_default_lead_notify BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION default_lead_notify_on_new_owner();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.quote_drafts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER auto_advance_on_quote AFTER INSERT ON public.quotes FOR EACH ROW EXECUTE FUNCTION on_quote_created();
CREATE TRIGGER auto_advance_on_quote_sent AFTER UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION on_quote_sent();
CREATE TRIGGER set_quote_token BEFORE INSERT ON public.quotes FOR EACH ROW EXECUTE FUNCTION generate_quote_token();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_send_meta_quote_sent AFTER INSERT OR UPDATE OF sent_at ON public.quotes FOR EACH ROW EXECUTE FUNCTION send_meta_quote_sent();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.review_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER auto_advance_on_sale AFTER INSERT OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION on_sale_completed();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sales_rep_invites FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER enforce_rep_limit BEFORE INSERT ON public.sales_reps FOR EACH ROW EXECUTE FUNCTION check_rep_limit();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sales_reps FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sms_agent_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.twilio_numbers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.voice_agent_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_webhook_endpoints_updated_at BEFORE UPDATE ON public.webhook_endpoints FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===== Row level security policies =====
create policy "Company members can log activity" on public.activity_log as permissive for insert to public
  with check ((company_id = current_company_id()));

create policy "Company members can view activity" on public.activity_log as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Internal users can view agency key mappings" on public.agency_key_mappings as permissive for select to public
  using ((company_id = current_company_id()));

create policy ai_perf_stats_select on public.ai_performance_stats as permissive for select to public
  using ((company_id IN ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

create policy ai_perf_stats_service_role on public.ai_performance_stats as permissive for all to public
  using (true)
  with check (true);

create policy "Company members can create ai workflow runs" on public.ai_workflow_runs as permissive for insert to public
  with check ((company_id = current_company_id()));

create policy "Company members can update ai workflow runs" on public.ai_workflow_runs as permissive for update to public
  using ((company_id = current_company_id()))
  with check ((company_id = current_company_id()));

create policy "Company members can view ai workflow runs" on public.ai_workflow_runs as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Company members can view workflow runs" on public.ai_workflow_runs as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Service role can insert workflow runs" on public.ai_workflow_runs as permissive for insert to public
  with check (true);

create policy "Users can delete own company keys" on public.api_keys as permissive for delete to public
  using ((company_id = current_company_id()));

create policy "Users can insert keys for own company" on public.api_keys as permissive for insert to public
  with check ((company_id = current_company_id()));

create policy "Users can update own company keys" on public.api_keys as permissive for update to public
  using ((company_id = current_company_id()))
  with check ((company_id = current_company_id()));

create policy "Users can view own company keys" on public.api_keys as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Company members can create appointments" on public.appointments as permissive for insert to public
  with check ((company_id = current_company_id()));

create policy "Company members can delete appointments" on public.appointments as permissive for delete to public
  using (((company_id = current_company_id()) AND has_permission(auth.uid(), 'can_edit_appointments'::text)));

create policy "Company members can update appointments" on public.appointments as permissive for update to public
  using (((company_id = current_company_id()) AND has_permission(auth.uid(), 'can_edit_appointments'::text)))
  with check ((company_id = current_company_id()));

create policy "Company members can view appointments" on public.appointments as permissive for select to public
  using (((company_id = current_company_id()) AND ((get_rep_visibility(auth.uid(), 'appointments'::text) = 'all'::rep_visibility) OR ((get_rep_visibility(auth.uid(), 'appointments'::text) = 'assigned_only'::rep_visibility) AND (assigned_to = auth.uid())))));

create policy "Owners can update own company" on public.companies as permissive for update to public
  using ((id = current_company_id()))
  with check ((id = current_company_id()));

create policy "Users can view own company" on public.companies as permissive for select to public
  using ((id = current_company_id()));

create policy admins_select_any_company on public.companies as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

create policy admins_update_any_company on public.companies as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))))
  with check (true);

create policy "Users can create API tokens for own company" on public.company_api_tokens as permissive for insert to public
  with check ((company_id = current_company_id()));

create policy "Users can delete own company API tokens" on public.company_api_tokens as permissive for delete to public
  using ((company_id = current_company_id()));

create policy "Users can update own company API tokens" on public.company_api_tokens as permissive for update to public
  using ((company_id = current_company_id()));

create policy "Users can view own company API tokens" on public.company_api_tokens as permissive for select to public
  using ((company_id = current_company_id()));

create policy company_knowledge_select on public.company_knowledge as permissive for select to public
  using ((company_id IN ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

create policy company_knowledge_service_role on public.company_knowledge as permissive for all to public
  using (true)
  with check (true);

create policy "Company members can create conversations" on public.conversations as permissive for insert to public
  with check ((company_id = current_company_id()));

create policy "Company members can update conversations" on public.conversations as permissive for update to public
  using (((company_id = current_company_id()) AND ((get_rep_visibility(auth.uid(), 'conversations'::text) = 'all'::rep_visibility) OR ((get_rep_visibility(auth.uid(), 'conversations'::text) = 'assigned_only'::rep_visibility) AND (assigned_to = auth.uid())))))
  with check ((company_id = current_company_id()));

create policy "Company members can view conversations" on public.conversations as permissive for select to public
  using (((company_id = current_company_id()) AND ((get_rep_visibility(auth.uid(), 'conversations'::text) = 'all'::rep_visibility) OR ((get_rep_visibility(auth.uid(), 'conversations'::text) = 'assigned_only'::rep_visibility) AND (assigned_to = auth.uid())))));

create policy "Company members can create custom fields" on public.custom_fields as permissive for insert to public
  with check ((company_id = current_company_id()));

create policy "Company members can delete custom fields" on public.custom_fields as permissive for delete to public
  using ((company_id = current_company_id()));

create policy "Company members can manage custom fields" on public.custom_fields as permissive for all to public
  using ((company_id = current_company_id()))
  with check ((company_id = current_company_id()));

create policy "Company members can update custom fields" on public.custom_fields as permissive for update to public
  using ((company_id = current_company_id()))
  with check ((company_id = current_company_id()));

create policy "Company members can view custom fields" on public.custom_fields as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Anyone can insert demo requests" on public.demo_requests as permissive for insert to public
  with check (true);

create policy "Service role can read demo requests" on public.demo_requests as permissive for select to public
  using ((auth.role() = 'service_role'::text));

create policy "Authenticated users can read voices" on public.elevenlabs_voices as permissive for select to authenticated
  using (true);

create policy industry_insights_select on public.industry_insights as permissive for select to public
  using ((auth.role() = 'authenticated'::text));

create policy industry_insights_service_role on public.industry_insights as permissive for all to public
  using (true)
  with check (true);

create policy "Company members can create lead custom field values" on public.lead_custom_field_values as permissive for insert to public
  with check ((company_id = current_company_id()));

create policy "Company members can delete lead custom field values" on public.lead_custom_field_values as permissive for delete to public
  using ((company_id = current_company_id()));

create policy "Company members can update lead custom field values" on public.lead_custom_field_values as permissive for update to public
  using ((company_id = current_company_id()))
  with check ((company_id = current_company_id()));

create policy "Company members can view lead custom field values" on public.lead_custom_field_values as permissive for select to public
  using ((company_id = current_company_id()));

create policy lead_disputes_insert on public.lead_disputes as permissive for insert to public
  with check (((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND (EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = lead_disputes.lead_id) AND (leads.is_ppl = true) AND (leads.company_id = lead_disputes.company_id))))));

create policy lead_disputes_select on public.lead_disputes as permissive for select to public
  using ((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

create policy "Company members can create leads" on public.leads as permissive for insert to public
  with check ((company_id = current_company_id()));

create policy "Company members can delete leads" on public.leads as permissive for delete to public
  using (((company_id = current_company_id()) AND has_permission(auth.uid(), 'can_edit_leads'::text)));

create policy "Company members can update leads" on public.leads as permissive for update to public
  using (((company_id = current_company_id()) AND has_permission(auth.uid(), 'can_edit_leads'::text)))
  with check ((company_id = current_company_id()));

create policy "Company members can view leads" on public.leads as permissive for select to public
  using (((company_id = current_company_id()) AND ((get_rep_visibility(auth.uid(), 'leads'::text) = 'all'::rep_visibility) OR ((get_rep_visibility(auth.uid(), 'leads'::text) = 'assigned_only'::rep_visibility) AND (assigned_to = auth.uid())))));

create policy "Company members can send messages" on public.messages as permissive for insert to public
  with check ((conversation_id IN ( SELECT conversations.id
   FROM conversations
  WHERE (conversations.company_id = current_company_id()))));

create policy "Company members can view messages" on public.messages as permissive for select to public
  using ((conversation_id IN ( SELECT conversations.id
   FROM conversations
  WHERE (conversations.company_id = current_company_id()))));

create policy "Admins can view meta assets" on public.meta_assets as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

create policy "Admins can view all meta events" on public.meta_capi_events as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

create policy "Users can view own company meta events" on public.meta_capi_events as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Service role full access on meta_connections" on public.meta_connections as permissive for all to public
  using ((auth.role() = 'service_role'::text));

create policy "Users can view own meta connection" on public.meta_connections as permissive for select to public
  using ((company_id IN ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

create policy niche_benchmarks_read on public.niche_benchmarks as permissive for select to public
  using ((auth.role() = 'authenticated'::text));

create policy niche_benchmarks_service on public.niche_benchmarks as permissive for all to public
  using ((auth.role() = 'service_role'::text));

create policy "Company members can update notifications" on public.notifications as permissive for update to public
  using ((company_id = current_company_id()))
  with check ((company_id = current_company_id()));

create policy "Company members can view notifications" on public.notifications as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Service role can insert notifications" on public.notifications as permissive for insert to public
  with check (true);

create policy pending_magic_links_service on public.pending_magic_links as permissive for all to public
  using ((auth.role() = 'service_role'::text));

create policy pacr_admin_select on public.ppl_area_change_requests as permissive for select to public
  using (is_super_admin());

create policy pacr_admin_update on public.ppl_area_change_requests as permissive for update to public
  using (is_super_admin())
  with check (is_super_admin());

create policy pacr_insert_own on public.ppl_area_change_requests as permissive for insert to public
  with check ((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

create policy pacr_select_own on public.ppl_area_change_requests as permissive for select to public
  using ((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

create policy pah_admin_select on public.ppl_area_history as permissive for select to public
  using (is_super_admin());

create policy ppl_call_attempts_insert on public.ppl_call_attempts as permissive for insert to public
  with check (((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))) AND (EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = ppl_call_attempts.lead_id) AND (leads.is_ppl = true) AND (leads.company_id = ppl_call_attempts.company_id))))));

create policy ppl_call_attempts_select on public.ppl_call_attempts as permissive for select to public
  using ((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

create policy "Service role full access on ppl_campaigns" on public.ppl_campaigns as permissive for all to public
  using ((auth.role() = 'service_role'::text));

create policy "Super admins can manage ppl_campaigns" on public.ppl_campaigns as permissive for all to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

create policy "Service role full access on ppl_lead_orders" on public.ppl_lead_orders as permissive for all to public
  using ((auth.role() = 'service_role'::text));

create policy ppl_lead_orders_delete_pending on public.ppl_lead_orders as permissive for delete to public
  using (((status = 'pending'::text) AND (company_id IN ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))));

create policy ppl_lead_orders_insert_admin on public.ppl_lead_orders as permissive for insert to public
  with check (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))) AND (company_id IN ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))));

create policy ppl_lead_orders_select_admin on public.ppl_lead_orders as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));

create policy ppl_lead_orders_select_own on public.ppl_lead_orders as permissive for select to public
  using ((company_id IN ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

create policy ppl_lead_orders_update_admin on public.ppl_lead_orders as permissive for update to public
  using (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))) AND (company_id IN ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))))
  with check (((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))) AND (company_id IN ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))));

create policy ppl_orders_insert on public.ppl_orders as permissive for insert to public
  with check ((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

create policy ppl_orders_select on public.ppl_orders as permissive for select to public
  using ((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

create policy ppl_orders_update on public.ppl_orders as permissive for update to public
  using ((company_id = ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

create policy "Authenticated users can read ppl_pricing" on public.ppl_pricing as permissive for select to public
  using ((auth.role() = 'authenticated'::text));

create policy "Service role full access on ppl_pricing" on public.ppl_pricing as permissive for all to public
  using ((auth.role() = 'service_role'::text));

create policy "Super admins can manage ppl_pricing" on public.ppl_pricing as permissive for all to public
  using (is_super_admin());

create policy "Admins can change member roles" on public.profiles as permissive for update to public
  using (((company_id = current_company_id()) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.company_id = profiles.company_id) AND (p.role = ANY (ARRAY['owner'::text, 'admin'::text])))))))
  with check (((company_id = current_company_id()) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.company_id = profiles.company_id) AND (p.role = ANY (ARRAY['owner'::text, 'admin'::text]))))) AND (is_admin = ( SELECT profiles_1.is_admin
   FROM profiles profiles_1
  WHERE (profiles_1.id = profiles_1.id)))));

create policy "Super-admins can read all profiles" on public.profiles as permissive for select to public
  using (is_super_admin());

create policy "Users can update own profile safe fields" on public.profiles as permissive for update to public
  using ((id = auth.uid()))
  with check (((id = auth.uid()) AND (role = ( SELECT profiles_1.role
   FROM profiles profiles_1
  WHERE (profiles_1.id = auth.uid()))) AND (company_id = ( SELECT profiles_1.company_id
   FROM profiles profiles_1
  WHERE (profiles_1.id = auth.uid()))) AND (user_type = ( SELECT profiles_1.user_type
   FROM profiles profiles_1
  WHERE (profiles_1.id = auth.uid()))) AND (is_team = ( SELECT profiles_1.is_team
   FROM profiles profiles_1
  WHERE (profiles_1.id = auth.uid()))) AND (is_admin = ( SELECT profiles_1.is_admin
   FROM profiles profiles_1
  WHERE (profiles_1.id = auth.uid()))) AND (team_role = ( SELECT profiles_1.team_role
   FROM profiles profiles_1
  WHERE (profiles_1.id = auth.uid())))));

create policy "Users can view company members" on public.profiles as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Company members can manage quote drafts" on public.quote_drafts as permissive for all to public
  using ((company_id = current_company_id()))
  with check ((company_id = current_company_id()));

create policy "Company members can view quote drafts" on public.quote_drafts as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Company members can create quotes" on public.quotes as permissive for insert to public
  with check ((company_id = current_company_id()));

create policy "Company members can delete quotes" on public.quotes as permissive for delete to public
  using (((company_id = current_company_id()) AND has_permission(auth.uid(), 'can_edit_quotes'::text)));

create policy "Company members can update quotes" on public.quotes as permissive for update to public
  using (((company_id = current_company_id()) AND has_permission(auth.uid(), 'can_edit_quotes'::text)))
  with check ((company_id = current_company_id()));

create policy "Company members can view quotes" on public.quotes as permissive for select to public
  using (((company_id = current_company_id()) AND ((get_rep_visibility(auth.uid(), 'quotes'::text) = 'all'::rep_visibility) OR ((get_rep_visibility(auth.uid(), 'quotes'::text) = 'assigned_only'::rep_visibility) AND ((created_by = auth.uid()) OR (lead_id IN ( SELECT leads.id
   FROM leads
  WHERE (leads.assigned_to = auth.uid()))))))));

create policy "Company admins can manage review requests" on public.review_requests as permissive for all to public
  using ((company_id IN ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

create policy "Company members can view review requests" on public.review_requests as permissive for select to public
  using ((company_id IN ( SELECT profiles.company_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));

create policy "Company members can create sales" on public.sales as permissive for insert to public
  with check ((company_id = current_company_id()));

create policy "Company members can delete sales" on public.sales as permissive for delete to public
  using (((company_id = current_company_id()) AND has_permission(auth.uid(), 'can_edit_leads'::text)));

create policy "Company members can update sales" on public.sales as permissive for update to public
  using (((company_id = current_company_id()) AND has_permission(auth.uid(), 'can_edit_leads'::text)))
  with check ((company_id = current_company_id()));

create policy "Company members can view sales" on public.sales as permissive for select to public
  using (((company_id = current_company_id()) AND ((get_rep_visibility(auth.uid(), 'sales'::text) = 'all'::rep_visibility) OR ((get_rep_visibility(auth.uid(), 'sales'::text) = 'assigned_only'::rep_visibility) AND (closed_by = auth.uid())))));

create policy "Admins can manage sales rep invites" on public.sales_rep_invites as permissive for all to public
  using (((company_id = current_company_id()) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::text, 'admin'::text])))))))
  with check (((company_id = current_company_id()) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));

create policy "Company members can manage invites" on public.sales_rep_invites as permissive for all to public
  using ((company_id = current_company_id()))
  with check ((company_id = current_company_id()));

create policy "Company members can view invites" on public.sales_rep_invites as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Company members can view sales rep invites" on public.sales_rep_invites as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Admins can create reps" on public.sales_reps as permissive for insert to public
  with check (((company_id = current_company_id()) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));

create policy "Admins can delete reps" on public.sales_reps as permissive for delete to public
  using (((company_id = current_company_id()) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));

create policy "Admins can update reps" on public.sales_reps as permissive for update to public
  using (((company_id = current_company_id()) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::text, 'admin'::text])))))))
  with check ((company_id = current_company_id()));

create policy "Company members can view reps" on public.sales_reps as permissive for select to public
  using ((company_id = current_company_id()));

create policy signup_attempts_service on public.signup_attempts as permissive for all to public
  using ((auth.role() = 'service_role'::text));

create policy "Company members can manage sms config" on public.sms_agent_config as permissive for all to public
  using ((company_id = current_company_id()))
  with check ((company_id = current_company_id()));

create policy "Company members can view sms config" on public.sms_agent_config as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Admins can update sms credits" on public.sms_credits as permissive for update to public
  using (((company_id = current_company_id()) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::text, 'admin'::text])))))))
  with check ((company_id = current_company_id()));

create policy "Company members can view sms credits" on public.sms_credits as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Service role can insert sms credits" on public.sms_credits as permissive for insert to public
  with check (true);

create policy "Company members can manage twilio numbers" on public.twilio_numbers as permissive for all to public
  using ((company_id = current_company_id()))
  with check ((company_id = current_company_id()));

create policy "Company members can view twilio numbers" on public.twilio_numbers as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Company members can manage voice config" on public.voice_agent_config as permissive for all to public
  using ((company_id = current_company_id()))
  with check ((company_id = current_company_id()));

create policy "Company members can view voice config" on public.voice_agent_config as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Company members can create calls" on public.voice_calls as permissive for insert to public
  with check ((company_id = current_company_id()));

create policy "Company members can update calls" on public.voice_calls as permissive for update to public
  using ((company_id = current_company_id()))
  with check ((company_id = current_company_id()));

create policy "Company members can view calls" on public.voice_calls as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Authenticated users can read volume_discount_tiers" on public.volume_discount_tiers as permissive for select to public
  using ((auth.role() = 'authenticated'::text));

create policy "Service role full access on volume_discount_tiers" on public.volume_discount_tiers as permissive for all to public
  using ((auth.role() = 'service_role'::text));

create policy "Super admins can manage volume_discount_tiers" on public.volume_discount_tiers as permissive for all to public
  using (is_super_admin());

create policy "Users can view own company webhook deliveries" on public.webhook_deliveries as permissive for select to public
  using ((company_id = current_company_id()));

create policy "Users can create webhooks for own company" on public.webhook_endpoints as permissive for insert to public
  with check ((company_id = current_company_id()));

create policy "Users can delete own company webhooks" on public.webhook_endpoints as permissive for delete to public
  using ((company_id = current_company_id()));

create policy "Users can update own company webhooks" on public.webhook_endpoints as permissive for update to public
  using ((company_id = current_company_id()));

create policy "Users can view own company webhooks" on public.webhook_endpoints as permissive for select to public
  using ((company_id = current_company_id()));

create policy "lead files readable by those who can see the lead" on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'lead-files'::text) AND (EXISTS ( SELECT 1
   FROM leads l
  WHERE (((l.id)::text = (storage.foldername(objects.name))[2]) AND ((l.company_id)::text = (storage.foldername(objects.name))[1]))))));


-- ===== Privileges =====
revoke all on table public.activity_log from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.activity_log to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.activity_log to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.activity_log to service_role;
revoke all on function public.add_sms_credits(p_company_id uuid, p_amount integer) from public, anon, authenticated, service_role;
grant execute on function public.add_sms_credits(p_company_id uuid, p_amount integer) to service_role;
revoke all on table public.agency_key_mappings from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agency_key_mappings to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agency_key_mappings to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.agency_key_mappings to service_role;
revoke all on function public.ai_live_leads() from public, anon, authenticated, service_role;
grant execute on function public.ai_live_leads() to anon;
grant execute on function public.ai_live_leads() to authenticated;
grant execute on function public.ai_live_leads() to public;
grant execute on function public.ai_live_leads() to service_role;
revoke all on table public.ai_performance_stats from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ai_performance_stats to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ai_performance_stats to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ai_performance_stats to service_role;
revoke all on table public.ai_workflow_runs from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ai_workflow_runs to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ai_workflow_runs to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ai_workflow_runs to service_role;
revoke all on table public.api_keys from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.api_keys to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.api_keys to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.api_keys to service_role;
revoke all on table public.appointments from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.appointments to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.appointments to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.appointments to service_role;
revoke all on function public.assign_shared_number_to_company() from public, anon, authenticated, service_role;
grant execute on function public.assign_shared_number_to_company() to anon;
grant execute on function public.assign_shared_number_to_company() to authenticated;
grant execute on function public.assign_shared_number_to_company() to public;
grant execute on function public.assign_shared_number_to_company() to service_role;
revoke all on table public.au_postcode_points from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.au_postcode_points to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.au_postcode_points to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.au_postcode_points to service_role;
revoke all on function public.autopilot_secret_ok(p text) from public, anon, authenticated, service_role;
grant execute on function public.autopilot_secret_ok(p text) to service_role;
revoke all on table public.business_settings from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.business_settings to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.business_settings to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.business_settings to service_role;
revoke all on table public.call_log from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.call_log to service_role;
revoke all on table public.campaign_builds from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.campaign_builds to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.campaign_builds to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.campaign_builds to service_role;
revoke all on function public.check_rep_limit() from public, anon, authenticated, service_role;
grant execute on function public.check_rep_limit() to anon;
grant execute on function public.check_rep_limit() to authenticated;
grant execute on function public.check_rep_limit() to public;
grant execute on function public.check_rep_limit() to service_role;
revoke all on function public.clean_expired_magic_links() from public, anon, authenticated, service_role;
grant execute on function public.clean_expired_magic_links() to service_role;
revoke all on function public.cleanup_expired_reset_tokens() from public, anon, authenticated, service_role;
grant execute on function public.cleanup_expired_reset_tokens() to anon;
grant execute on function public.cleanup_expired_reset_tokens() to authenticated;
grant execute on function public.cleanup_expired_reset_tokens() to public;
grant execute on function public.cleanup_expired_reset_tokens() to service_role;
revoke all on table public.client_email_log from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.client_email_log to service_role;
revoke all on table public.client_notes from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.client_notes to service_role;
revoke all on table public.client_reminders from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.client_reminders to service_role;
revoke all on table public.companies from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.companies to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.companies to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.companies to service_role;
revoke all on table public.company_api_tokens from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.company_api_tokens to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.company_api_tokens to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.company_api_tokens to service_role;
revoke all on table public.company_assets from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.company_assets to service_role;
revoke all on table public.company_capi_tokens from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.company_capi_tokens to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.company_capi_tokens to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.company_capi_tokens to service_role;
revoke all on function public.company_engagement_stats(p_company_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.company_engagement_stats(p_company_id uuid) to anon;
grant execute on function public.company_engagement_stats(p_company_id uuid) to authenticated;
grant execute on function public.company_engagement_stats(p_company_id uuid) to public;
grant execute on function public.company_engagement_stats(p_company_id uuid) to service_role;
revoke all on function public.company_fulfilment_recalc() from public, anon, authenticated, service_role;
grant execute on function public.company_fulfilment_recalc() to service_role;
revoke all on table public.company_fulfilment_summary from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.company_fulfilment_summary to service_role;
revoke all on function public.company_fulfilment_touch() from public, anon, authenticated, service_role;
grant execute on function public.company_fulfilment_touch() to service_role;
revoke all on table public.company_fulfilment from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.company_fulfilment to service_role;
revoke all on table public.company_knowledge from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.company_knowledge to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.company_knowledge to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.company_knowledge to service_role;
revoke all on table public.conversations from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.conversations to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.conversations to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.conversations to service_role;
revoke all on function public.count_active_and_pending_sales_reps(p_company_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.count_active_and_pending_sales_reps(p_company_id uuid) to anon;
grant execute on function public.count_active_and_pending_sales_reps(p_company_id uuid) to authenticated;
grant execute on function public.count_active_and_pending_sales_reps(p_company_id uuid) to public;
grant execute on function public.count_active_and_pending_sales_reps(p_company_id uuid) to service_role;
revoke all on table public.creative_rounds from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.creative_rounds to service_role;
revoke all on function public.current_company_id() from public, anon, authenticated, service_role;
grant execute on function public.current_company_id() to anon;
grant execute on function public.current_company_id() to authenticated;
grant execute on function public.current_company_id() to public;
grant execute on function public.current_company_id() to service_role;
revoke all on table public.custom_fields from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.custom_fields to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.custom_fields to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.custom_fields to service_role;
revoke all on function public.decrypt_api_key(p_encrypted bytea, p_company_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.decrypt_api_key(p_encrypted bytea, p_company_id uuid) to service_role;
revoke all on function public.deduct_sms_credit(p_company_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.deduct_sms_credit(p_company_id uuid) to service_role;
revoke all on function public.default_lead_notify_on_new_owner() from public, anon, authenticated, service_role;
grant execute on function public.default_lead_notify_on_new_owner() to anon;
grant execute on function public.default_lead_notify_on_new_owner() to authenticated;
grant execute on function public.default_lead_notify_on_new_owner() to public;
grant execute on function public.default_lead_notify_on_new_owner() to service_role;
revoke all on table public.demo_requests from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.demo_requests to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.demo_requests to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.demo_requests to service_role;
revoke all on table public.elevenlabs_voices from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.elevenlabs_voices to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.elevenlabs_voices to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.elevenlabs_voices to service_role;
revoke all on table public.email_templates from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.email_templates to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.email_templates to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.email_templates to service_role;
revoke all on function public.encrypt_api_key(p_raw_key text, p_company_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.encrypt_api_key(p_raw_key text, p_company_id uuid) to service_role;
revoke all on function public.enforce_ppl_lead_lock() from public, anon, authenticated, service_role;
grant execute on function public.enforce_ppl_lead_lock() to anon;
grant execute on function public.enforce_ppl_lead_lock() to authenticated;
grant execute on function public.enforce_ppl_lead_lock() to public;
grant execute on function public.enforce_ppl_lead_lock() to service_role;
revoke all on table public.fulfilment_log from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.fulfilment_log to service_role;
revoke all on table public.fulfilment_step_defs from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.fulfilment_step_defs to service_role;
revoke all on function public.generate_quote_token() from public, anon, authenticated, service_role;
grant execute on function public.generate_quote_token() to anon;
grant execute on function public.generate_quote_token() to authenticated;
grant execute on function public.generate_quote_token() to public;
grant execute on function public.generate_quote_token() to service_role;
revoke all on function public.get_auth_user_id_by_email(user_email text) from public, anon, authenticated, service_role;
grant execute on function public.get_auth_user_id_by_email(user_email text) to service_role;
revoke all on function public.get_company_capi_token(p_company uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_company_capi_token(p_company uuid) to service_role;
revoke all on function public.get_ppl_dispute_eligibility(p_lead_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_ppl_dispute_eligibility(p_lead_id uuid) to authenticated;
grant execute on function public.get_ppl_dispute_eligibility(p_lead_id uuid) to service_role;
revoke all on function public.get_ppl_scrub_usage(p_company_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_ppl_scrub_usage(p_company_id uuid) to service_role;
revoke all on function public.get_rep_visibility(p_user_id uuid, p_section text) from public, anon, authenticated, service_role;
grant execute on function public.get_rep_visibility(p_user_id uuid, p_section text) to anon;
grant execute on function public.get_rep_visibility(p_user_id uuid, p_section text) to authenticated;
grant execute on function public.get_rep_visibility(p_user_id uuid, p_section text) to public;
grant execute on function public.get_rep_visibility(p_user_id uuid, p_section text) to service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
grant execute on function public.handle_new_user() to anon;
grant execute on function public.handle_new_user() to authenticated;
grant execute on function public.handle_new_user() to public;
grant execute on function public.handle_new_user() to service_role;
revoke all on function public.has_permission(p_user_id uuid, p_permission text) from public, anon, authenticated, service_role;
grant execute on function public.has_permission(p_user_id uuid, p_permission text) to anon;
grant execute on function public.has_permission(p_user_id uuid, p_permission text) to authenticated;
grant execute on function public.has_permission(p_user_id uuid, p_permission text) to public;
grant execute on function public.has_permission(p_user_id uuid, p_permission text) to service_role;
revoke all on function public.increment_ppl_order_delivered() from public, anon, authenticated, service_role;
grant execute on function public.increment_ppl_order_delivered() to anon;
grant execute on function public.increment_ppl_order_delivered() to authenticated;
grant execute on function public.increment_ppl_order_delivered() to public;
grant execute on function public.increment_ppl_order_delivered() to service_role;
revoke all on table public.industry_insights from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.industry_insights to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.industry_insights to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.industry_insights to service_role;
revoke all on sequence public.invoice_number_seq from public, anon, authenticated, service_role;
grant SELECT, UPDATE, USAGE on sequence public.invoice_number_seq to anon;
grant SELECT, UPDATE, USAGE on sequence public.invoice_number_seq to authenticated;
grant SELECT, UPDATE, USAGE on sequence public.invoice_number_seq to service_role;
revoke all on table public.invoices from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.invoices to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.invoices to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.invoices to service_role;
revoke all on function public.is_super_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_super_admin() to anon;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_super_admin() to public;
grant execute on function public.is_super_admin() to service_role;
revoke all on table public.lead_custom_field_values from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.lead_custom_field_values to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.lead_custom_field_values to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.lead_custom_field_values to service_role;
revoke all on table public.lead_disputes from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.lead_disputes to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.lead_disputes to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.lead_disputes to service_role;
revoke all on table public.lead_notification_log from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.lead_notification_log to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.lead_notification_log to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.lead_notification_log to service_role;
revoke all on function public.leads_normalise_phone() from public, anon, authenticated, service_role;
grant execute on function public.leads_normalise_phone() to anon;
grant execute on function public.leads_normalise_phone() to authenticated;
grant execute on function public.leads_normalise_phone() to public;
grant execute on function public.leads_normalise_phone() to service_role;
revoke all on table public.leads from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.leads to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.leads to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.leads to service_role;
revoke all on function public.media_cleanup_secret_ok(p text) from public, anon, authenticated, service_role;
grant execute on function public.media_cleanup_secret_ok(p text) to service_role;
revoke all on table public.media_uploads from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.media_uploads to service_role;
revoke all on table public.messages from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.messages to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.messages to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.messages to service_role;
revoke all on table public.meta_assets from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.meta_assets to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.meta_assets to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.meta_assets to service_role;
revoke all on table public.meta_capi_events from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.meta_capi_events to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.meta_capi_events to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.meta_capi_events to service_role;
revoke all on table public.meta_connections from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.meta_connections to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.meta_connections to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.meta_connections to service_role;
revoke all on table public.meta_leads from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.meta_leads to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.meta_leads to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.meta_leads to service_role;
revoke all on function public.meta_watch_secret_ok(p text) from public, anon, authenticated, service_role;
grant execute on function public.meta_watch_secret_ok(p text) to service_role;
revoke all on table public.niche_benchmarks from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.niche_benchmarks to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.niche_benchmarks to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.niche_benchmarks to service_role;
revoke all on function public.norm_au_phone(p text) from public, anon, authenticated, service_role;
grant execute on function public.norm_au_phone(p text) to anon;
grant execute on function public.norm_au_phone(p text) to authenticated;
grant execute on function public.norm_au_phone(p text) to public;
grant execute on function public.norm_au_phone(p text) to service_role;
revoke all on function public.normalise_au_phone(raw text) from public, anon, authenticated, service_role;
grant execute on function public.normalise_au_phone(raw text) to anon;
grant execute on function public.normalise_au_phone(raw text) to authenticated;
grant execute on function public.normalise_au_phone(raw text) to public;
grant execute on function public.normalise_au_phone(raw text) to service_role;
revoke all on table public.notifications from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.notifications to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.notifications to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.notifications to service_role;
revoke all on function public.notify_new_lead() from public, anon, authenticated, service_role;
grant execute on function public.notify_new_lead() to anon;
grant execute on function public.notify_new_lead() to authenticated;
grant execute on function public.notify_new_lead() to public;
grant execute on function public.notify_new_lead() to service_role;
revoke all on function public.notify_ppl_area_change_request() from public, anon, authenticated, service_role;
grant execute on function public.notify_ppl_area_change_request() to anon;
grant execute on function public.notify_ppl_area_change_request() to authenticated;
grant execute on function public.notify_ppl_area_change_request() to public;
grant execute on function public.notify_ppl_area_change_request() to service_role;
revoke all on function public.on_quote_created() from public, anon, authenticated, service_role;
grant execute on function public.on_quote_created() to anon;
grant execute on function public.on_quote_created() to authenticated;
grant execute on function public.on_quote_created() to public;
grant execute on function public.on_quote_created() to service_role;
revoke all on function public.on_quote_sent() from public, anon, authenticated, service_role;
grant execute on function public.on_quote_sent() to anon;
grant execute on function public.on_quote_sent() to authenticated;
grant execute on function public.on_quote_sent() to public;
grant execute on function public.on_quote_sent() to service_role;
revoke all on function public.on_sale_completed() from public, anon, authenticated, service_role;
grant execute on function public.on_sale_completed() to anon;
grant execute on function public.on_sale_completed() to authenticated;
grant execute on function public.on_sale_completed() to public;
grant execute on function public.on_sale_completed() to service_role;
revoke all on function public.onboarding_submissions_touch() from public, anon, authenticated, service_role;
grant execute on function public.onboarding_submissions_touch() to service_role;
revoke all on table public.onboarding_submissions from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.onboarding_submissions to service_role;
revoke all on table public.password_reset_tokens from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.password_reset_tokens to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.password_reset_tokens to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.password_reset_tokens to service_role;
revoke all on table public.pending_magic_links from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.pending_magic_links to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.pending_magic_links to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.pending_magic_links to service_role;
revoke all on table public.platform_settings from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.platform_settings to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.platform_settings to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.platform_settings to service_role;
revoke all on function public.ppl_agreed_postcodes_at(p_company_id uuid, p_at timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public.ppl_agreed_postcodes_at(p_company_id uuid, p_at timestamp with time zone) to anon;
grant execute on function public.ppl_agreed_postcodes_at(p_company_id uuid, p_at timestamp with time zone) to authenticated;
grant execute on function public.ppl_agreed_postcodes_at(p_company_id uuid, p_at timestamp with time zone) to public;
grant execute on function public.ppl_agreed_postcodes_at(p_company_id uuid, p_at timestamp with time zone) to service_role;
revoke all on table public.ppl_area_change_requests from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_area_change_requests to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_area_change_requests to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_area_change_requests to service_role;
revoke all on table public.ppl_area_history from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_area_history to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_area_history to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_area_history to service_role;
revoke all on table public.ppl_call_attempts from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_call_attempts to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_call_attempts to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_call_attempts to service_role;
revoke all on table public.ppl_campaigns from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_campaigns to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_campaigns to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_campaigns to service_role;
revoke all on table public.ppl_lead_orders from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_lead_orders to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_lead_orders to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_lead_orders to service_role;
revoke all on function public.ppl_open_area_postcodes() from public, anon, authenticated, service_role;
grant execute on function public.ppl_open_area_postcodes() to service_role;
revoke all on table public.ppl_orders from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_orders to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_orders to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_orders to service_role;
revoke all on function public.ppl_postcodes_in_state(p_state text) from public, anon, authenticated, service_role;
grant execute on function public.ppl_postcodes_in_state(p_state text) to service_role;
revoke all on function public.ppl_postcodes_within(p_lat double precision, p_lng double precision, p_km double precision) from public, anon, authenticated, service_role;
grant execute on function public.ppl_postcodes_within(p_lat double precision, p_lng double precision, p_km double precision) to service_role;
revoke all on table public.ppl_pricing from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_pricing to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_pricing to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.ppl_pricing to service_role;
revoke all on table public.preview_links from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.preview_links to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.preview_links to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.preview_links to service_role;
revoke all on table public.profiles from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.profiles to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.profiles to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.profiles to service_role;
revoke all on function public.provision_agency_keys() from public, anon, authenticated, service_role;
grant execute on function public.provision_agency_keys() to anon;
grant execute on function public.provision_agency_keys() to authenticated;
grant execute on function public.provision_agency_keys() to public;
grant execute on function public.provision_agency_keys() to service_role;
revoke all on function public.provision_sms_for_company() from public, anon, authenticated, service_role;
grant execute on function public.provision_sms_for_company() to anon;
grant execute on function public.provision_sms_for_company() to authenticated;
grant execute on function public.provision_sms_for_company() to public;
grant execute on function public.provision_sms_for_company() to service_role;
revoke all on table public.quote_drafts from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.quote_drafts to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.quote_drafts to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.quote_drafts to service_role;
revoke all on table public.quote_followup_queue from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.quote_followup_queue to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.quote_followup_queue to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.quote_followup_queue to service_role;
revoke all on table public.quotes from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.quotes to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.quotes to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.quotes to service_role;
revoke all on function public.recalc_company_fulfilment(p_company_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.recalc_company_fulfilment(p_company_id uuid) to service_role;
revoke all on function public.record_ppl_area_change() from public, anon, authenticated, service_role;
grant execute on function public.record_ppl_area_change() to anon;
grant execute on function public.record_ppl_area_change() to authenticated;
grant execute on function public.record_ppl_area_change() to public;
grant execute on function public.record_ppl_area_change() to service_role;
revoke all on function public.refresh_niche_benchmarks() from public, anon, authenticated, service_role;
grant execute on function public.refresh_niche_benchmarks() to authenticated;
grant execute on function public.refresh_niche_benchmarks() to service_role;
revoke all on function public.refund_sms_credit(p_company_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.refund_sms_credit(p_company_id uuid) to service_role;
revoke all on function public.reset_monthly_sms_credits() from public, anon, authenticated, service_role;
grant execute on function public.reset_monthly_sms_credits() to service_role;
revoke all on function public.resolve_api_key(p_company_id uuid, p_provider api_key_provider) from public, anon, authenticated, service_role;
grant execute on function public.resolve_api_key(p_company_id uuid, p_provider api_key_provider) to service_role;
revoke all on function public.resolve_shared_number_owner(p_company_ids uuid[], p_phones text[]) from public, anon, authenticated, service_role;
grant execute on function public.resolve_shared_number_owner(p_company_ids uuid[], p_phones text[]) to service_role;
revoke all on table public.review_requests from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.review_requests to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.review_requests to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.review_requests to service_role;
revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;
grant execute on function public.rls_auto_enable() to anon;
grant execute on function public.rls_auto_enable() to authenticated;
grant execute on function public.rls_auto_enable() to public;
grant execute on function public.rls_auto_enable() to service_role;
revoke all on function public.route_lead(p_company_id uuid, p_postcode text) from public, anon, authenticated, service_role;
grant execute on function public.route_lead(p_company_id uuid, p_postcode text) to authenticated;
grant execute on function public.route_lead(p_company_id uuid, p_postcode text) to service_role;
revoke all on table public.sales_rep_invites from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sales_rep_invites to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sales_rep_invites to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sales_rep_invites to service_role;
revoke all on table public.sales_reps from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sales_reps to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sales_reps to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sales_reps to service_role;
revoke all on table public.sales from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sales to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sales to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sales to service_role;
revoke all on function public.send_meta_conversion() from public, anon, authenticated, service_role;
grant execute on function public.send_meta_conversion() to anon;
grant execute on function public.send_meta_conversion() to authenticated;
grant execute on function public.send_meta_conversion() to public;
grant execute on function public.send_meta_conversion() to service_role;
revoke all on function public.send_meta_event(p_lead uuid, p_event text) from public, anon, authenticated, service_role;
grant execute on function public.send_meta_event(p_lead uuid, p_event text) to service_role;
revoke all on function public.send_meta_quote_sent() from public, anon, authenticated, service_role;
grant execute on function public.send_meta_quote_sent() to anon;
grant execute on function public.send_meta_quote_sent() to authenticated;
grant execute on function public.send_meta_quote_sent() to public;
grant execute on function public.send_meta_quote_sent() to service_role;
revoke all on function public.send_meta_schedule() from public, anon, authenticated, service_role;
grant execute on function public.send_meta_schedule() to anon;
grant execute on function public.send_meta_schedule() to authenticated;
grant execute on function public.send_meta_schedule() to public;
grant execute on function public.send_meta_schedule() to service_role;
revoke all on function public.send_welcome_email() from public, anon, authenticated, service_role;
grant execute on function public.send_welcome_email() to anon;
grant execute on function public.send_welcome_email() to authenticated;
grant execute on function public.send_welcome_email() to public;
grant execute on function public.send_welcome_email() to service_role;
revoke all on function public.set_company_capi_token(p_company uuid, p_token text) from public, anon, authenticated, service_role;
grant execute on function public.set_company_capi_token(p_company uuid, p_token text) to service_role;
revoke all on function public.set_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.set_updated_at() to anon;
grant execute on function public.set_updated_at() to authenticated;
grant execute on function public.set_updated_at() to public;
grant execute on function public.set_updated_at() to service_role;
revoke all on table public.signup_attempts from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.signup_attempts to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.signup_attempts to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.signup_attempts to service_role;
revoke all on table public.sms_agent_config from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sms_agent_config to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sms_agent_config to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sms_agent_config to service_role;
revoke all on table public.sms_credits from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sms_credits to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sms_credits to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sms_credits to service_role;
revoke all on function public.sms_is_opted_out(p_company_id uuid, p_phone text) from public, anon, authenticated, service_role;
grant execute on function public.sms_is_opted_out(p_company_id uuid, p_phone text) to service_role;
revoke all on table public.sms_opt_outs from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.sms_opt_outs to service_role;
revoke all on function public.sms_set_opt_out(p_company_id uuid, p_phone text, p_opted_out boolean, p_source text) from public, anon, authenticated, service_role;
grant execute on function public.sms_set_opt_out(p_company_id uuid, p_phone text, p_opted_out boolean, p_source text) to service_role;
revoke all on table public.stock_assets from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.stock_assets to service_role;
revoke all on table public.stripe_webhook_events from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.stripe_webhook_events to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.stripe_webhook_events to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.stripe_webhook_events to service_role;
revoke all on function public.sync_is_ppl_from_source() from public, anon, authenticated, service_role;
grant execute on function public.sync_is_ppl_from_source() to anon;
grant execute on function public.sync_is_ppl_from_source() to authenticated;
grant execute on function public.sync_is_ppl_from_source() to public;
grant execute on function public.sync_is_ppl_from_source() to service_role;
revoke all on function public.sync_lead_name() from public, anon, authenticated, service_role;
grant execute on function public.sync_lead_name() to anon;
grant execute on function public.sync_lead_name() to authenticated;
grant execute on function public.sync_lead_name() to public;
grant execute on function public.sync_lead_name() to service_role;
revoke all on table public.team_assignments from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.team_assignments to service_role;
revoke all on table public.team_availability from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.team_availability to service_role;
revoke all on table public.team_role_permissions from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.team_role_permissions to service_role;
revoke all on table public.team_sms_message from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.team_sms_message to service_role;
revoke all on function public.tick_first_lead() from public, anon, authenticated, service_role;
grant execute on function public.tick_first_lead() to anon;
grant execute on function public.tick_first_lead() to authenticated;
grant execute on function public.tick_first_lead() to public;
grant execute on function public.tick_first_lead() to service_role;
revoke all on table public.twilio_numbers from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.twilio_numbers to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.twilio_numbers to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.twilio_numbers to service_role;
revoke all on table public.voice_agent_config from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.voice_agent_config to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.voice_agent_config to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.voice_agent_config to service_role;
revoke all on table public.voice_calls from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.voice_calls to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.voice_calls to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.voice_calls to service_role;
revoke all on table public.volume_discount_tiers from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.volume_discount_tiers to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.volume_discount_tiers to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.volume_discount_tiers to service_role;
revoke all on table public.webhook_deliveries from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.webhook_deliveries to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.webhook_deliveries to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.webhook_deliveries to service_role;
revoke all on table public.webhook_endpoints from public, anon, authenticated, service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.webhook_endpoints to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.webhook_endpoints to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.webhook_endpoints to service_role;

-- ===== Realtime, storage buckets and comments =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('lead-files', 'lead-files', false, 10485760, '{application/pdf,image/jpeg,image/png}'::text[]) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('preview-images', 'preview-images', true, 10485760, '{image/png,image/jpeg,image/jpg,image/gif,image/webp}'::text[]) on conflict (id) do nothing;
comment on table public.au_postcode_points is 'Australian postcode locations from GeoNames (geonames.org), CC BY 4.0. Used to turn a pay-per-lead radius into postcodes.';
comment on column public.companies.generated_ad_copy is 'The ad copy fulfilment-ai generated, with the model and timestamp. Regenerated rather than hand-edited; the version sent to the client is the one in the preview email.';
comment on column public.companies.management_fee_cents is 'Monthly management fee in cents, ex GST. NULL = the standard fee (currently $600), so a price change follows automatically. Set per client in /admin.';
comment on column public.companies.max_daily_ad_spend is 'From the growth onboarding form. Used as context when generating ad copy.';
comment on table public.company_fulfilment_summary is 'Derived roll-up of company_fulfilment, mirrored to ql-mc clients. Separate from companies so no client-facing row carries fulfilment state.';
comment on column public.email_templates.slug is 'Nominates a template for a specific flow. onboarding_intro = the VA intro email.';
comment on table public.fulfilment_log is 'Append-only internal audit trail of Internal Team actions on a client. Never visible to the client - that is why it is not activity_log.';
comment on table public.fulfilment_step_defs is 'Ordered catalogue of fulfilment steps. Widen by inserting a row, never by adding another boolean to companies.';
comment on column public.fulfilment_step_defs.automation is 'Names the automation that can complete this step (ad_copy, creatives, preview_email, …). NULL = only a person can tick it.';
comment on column public.fulfilment_step_defs.mc_active_status is 'The clients.active_status value in ql-mc this step implies (only ads_live sets one today).';
comment on column public.fulfilment_step_defs.mc_sub_stage is 'The clients.onboarding_sub_stage value in ql-mc that this step means we have reached. NULL = this step does not move the kanban.';
comment on table public.onboarding_submissions is 'Every growth-onboarding submission, its spam-gate verdict and what the automation did with it. Internal only.';
comment on column public.onboarding_submissions.gate_status is 'held = no match in ql-mc, no account created, waiting on a human. The gate holds rather than rejects on purpose.';
comment on column public.onboarding_submissions.payload is 'The form exactly as posted, so a field added to the form is captured before anyone remembers to add a column.';
comment on column public.ppl_pricing.max_order_qty is 'Max leads purchasable in a single order for this niche/area. NULL = unlimited (up to the app ceiling of 500).';
comment on column public.profiles.is_team is 'On the Internal Team (the Team Panel at /team-panel). Was is_va.';
comment on column public.profiles.team_reply_to_email is 'Reply-To on emails this VA sends. Falls back to their login email.';
comment on column public.profiles.team_role is 'Internal Team job, only meaningful when is_team. Mirrors ql-mc team_members.role. ops_manager sees every client; everyone else sees their assignments.';
comment on column public.sms_agent_config.auto_send_welcome is 'When true, automatically send the welcome_message SMS to every new lead that has a phone number.';
comment on column public.sms_agent_config.google_review_link is 'Google review URL for the business.';
comment on column public.sms_agent_config.quote_pricing_config is 'Pricing items and formula used by AI when auto-drafting quotes. Contains items array, optional formula, tax_rate, currency, and notes.';
comment on column public.sms_agent_config.review_auto_send is 'When true, sends review SMS automatically. When false, creates a pending request for manual approval.';
comment on column public.sms_agent_config.review_delay_days is 'Days after closed_won before sending review request.';
comment on column public.sms_agent_config.review_enabled is 'Enable review request SMS after closed_won.';
comment on column public.sms_agent_config.review_message is 'Template for review request SMS. Supports {{first_name}} and {{review_link}} placeholders.';
comment on table public.team_assignments is 'Which client companies each Internal Team member manages. Was va_assignments.';
comment on table public.team_availability is 'Weekly call availability per Internal Team member. Was va_availability.';
comment on table public.team_role_permissions is 'What each Internal Team role may do. Edited in /admin, enforced in team-api. Admins are never limited by this table.';
comment on column public.team_role_permissions.all_clients is 'false = assigned clients only. Replaces the hardcoded "ops_manager sees everything".';
comment on column public.team_role_permissions.fulfilment_view is 'Gates the Fulfilment tab, the board and the per-client checklist. A CSM defaults to false.';
comment on column public.voice_agent_config.vapi_phone_number_id is 'VAPI phone number ID — the registered outbound caller number in the VAPI account';
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.webhook_deliveries;

-- ===== Scheduled jobs =====
select cron.schedule('campaign-autopilot', '*/5 * * * *', ' select net.http_post(
       url     := ''https://wjadekgptkstfdootuol.supabase.co/functions/v1/campaign-build'',
       headers := jsonb_build_object(
                    ''Content-Type'', ''application/json'',
                    ''x-autopilot-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''autopilot_secret'')),
       body    := ''{"action":"autopilot"}''::jsonb,
       timeout_milliseconds := 150000) ');

select cron.schedule('creative-autopilot', '*/5 * * * *', ' select net.http_post(
       url     := ''https://wjadekgptkstfdootuol.supabase.co/functions/v1/creative-rounds'',
       headers := jsonb_build_object(
                    ''Content-Type'', ''application/json'',
                    ''x-autopilot-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''autopilot_secret'')),
       body    := ''{"action":"autopilot"}''::jsonb,
       timeout_milliseconds := 150000) ');

select cron.schedule('cron-history-trim', '23 3 * * *', ' delete from cron.job_run_details where end_time < now() - interval ''3 days'' ');
select cron.schedule('media-cleanup', '17 17 * * *', ' select net.http_post(
       url     := ''https://wjadekgptkstfdootuol.supabase.co/functions/v1/media-cleanup'',
       headers := jsonb_build_object(
                    ''Content-Type'', ''application/json'',
                    ''x-cleanup-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''media_cleanup_secret'')),
       body    := ''{}''::jsonb,
       timeout_milliseconds := 60000) ');

select cron.schedule('meta-access-watch', '*/15 * * * *', ' select net.http_post(
       url     := ''https://wjadekgptkstfdootuol.supabase.co/functions/v1/meta-access-watch'',
       headers := jsonb_build_object(
                    ''Content-Type'', ''application/json'',
                    ''x-watch-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''meta_watch_secret'')),
       body    := ''{}''::jsonb,
       timeout_milliseconds := 60000) ');

select cron.schedule('meta-capi-retry', '*/30 * * * *', ' select net.http_post(
       url     := ''https://wjadekgptkstfdootuol.supabase.co/functions/v1/meta-capi'',
       headers := jsonb_build_object(
                    ''Content-Type'', ''application/json'',
                    ''x-autopilot-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''autopilot_secret'')),
       body    := ''{"action":"retry"}''::jsonb,
       timeout_milliseconds := 120000) ');

select cron.schedule('meta-leads-subscribe', '*/30 * * * *', ' select net.http_post(
       url     := ''https://wjadekgptkstfdootuol.supabase.co/functions/v1/meta-leads'',
       headers := jsonb_build_object(
                    ''Content-Type'', ''application/json'',
                    ''x-autopilot-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''autopilot_secret'')),
       body    := ''{"action":"subscribe"}''::jsonb,
       timeout_milliseconds := 120000) ');
