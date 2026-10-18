-- Leads from the forms campaign-build makes come through Make, like every
-- other client's, so each client's custom integrations run. campaign-build no
-- longer collects them, and the table it kept them in goes (it never held a
-- lead). The campaign-autopilot job now only builds campaigns.
drop table if exists public.meta_leads;
