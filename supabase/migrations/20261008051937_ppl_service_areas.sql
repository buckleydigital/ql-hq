-- Several suburbs per pay-per-lead order.
--
-- A radius order used to be one circle around the chosen city's centre. The
-- signup form now lets the buyer add up to five suburbs, each with its own
-- travel radius. The list is kept as-is alongside the existing columns, which
-- stay populated (radius_km holds the largest radius) so nothing that reads
-- them changes.
--
-- Shape: [{ "label": text, "lat": number, "lng": number, "radius_km": int }]
--
-- signup_attempts holds it between checkout and payment (Stripe metadata
-- values are capped at 500 characters, too small for the full list); the
-- webhook copies it onto the order it creates.

alter table public.ppl_lead_orders add column if not exists service_areas jsonb;
alter table public.signup_attempts add column if not exists service_areas jsonb;
