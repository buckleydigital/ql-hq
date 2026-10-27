-- The VA's invoice reminder (functions/invoice-reminders). One email per
-- client per payment date: the key is claimed before anyone is told, so a
-- second run the same day, or a retry, tells nobody twice.
create table if not exists public.invoice_reminders_sent (
  key text primary key,
  created_at timestamptz not null default now()
);
alter table public.invoice_reminders_sent enable row level security;
revoke all on table public.invoice_reminders_sent from public, anon, authenticated;

-- 7:35am Sydney daylight time, half an hour after ql-mc drafts the invoices.
select cron.schedule('invoice-reminders', '35 20 * * *', $$
  select net.http_post(
    url     := 'https://wjadekgptkstfdootuol.supabase.co/functions/v1/invoice-reminders',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-autopilot-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000)
$$);
