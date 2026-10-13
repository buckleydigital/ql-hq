-- =============================================================================
-- Stripe webhook de-duplication
-- =============================================================================
-- Stripe may deliver the same event more than once. stripe-webhook inserts
-- each checkout.session.completed event id here before acting on it and skips
-- the event if the id is already present, so a repeat delivery can't add SMS
-- credits or create a lead order twice. Written only by the service role.

create table if not exists public.stripe_webhook_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
