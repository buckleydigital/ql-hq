-- The welcome email a new system client gets when their onboarding form is
-- accepted (growth-onboarding reads this template before its built-in copy).
-- It now leads with the first thing they have to do: give us Meta access.
-- Before, it never mentioned it, so a client who closed the thank-you screen
-- heard nothing about it until the day 2 reminder.
insert into public.email_templates (name, slug, subject, body)
select 'Growth welcome', 'growth_welcome',
       'Welcome to QuoteLeads - your account is ready',
       $t$Hi {first_name},

Thanks for getting your onboarding details over. Your QuoteLeads account is set up and ready.

Set your password and log in here:
{setup_link}

First step, about 5 minutes: give us access to your Facebook Page and ad account so we can start building your campaigns. Follow the step-by-step guide here:
https://quoteleadshq.com/dashboard?page=onboarding

You keep full ownership of everything. Once access is through, add your payment method inside Meta Ads Manager.

What happens next:

  1. We build your ad copy and creatives and send them over for approval
  2. You approve the previews, nothing goes live before you do
  3. We launch, usually within 24 to 48 hours of approval

If anything in your onboarding answers needs changing, or you get stuck on the access step, just reply to this email.

QuoteLeads$t$
where not exists (select 1 from public.email_templates where slug = 'growth_welcome');
