-- Remove the landscaping niche from PPL pricing.
--
-- It was seeded once in 20260521000002 alongside the real niches and was never
-- an offering. Nothing else references it: no per-area rows were ever seeded
-- for it, it has no sub-niches, and it is absent from the /admin niche filter,
-- the buy-leads trade picker and the ql-hq dashboard. The row only ever showed
-- up as an unfilterable entry in the /admin pricing table.
--
-- Safe to run: ppl_pricing has no foreign keys pointing at it, and orders
-- snapshot price_per_lead at purchase time, so any historical landscaping order
-- keeps the price it was actually charged.

delete from public.ppl_pricing
where lower(trim(niche)) = 'landscaping';
