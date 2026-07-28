-- ============================================================================
-- Restore roofing + renovation as sellable PPL niches
-- ============================================================================
-- Reverses the config deletes in 20260705000008 by re-seeding ppl_pricing.
--
--   • niche_benchmarks  — NOT re-seeded here; it self-repopulates via
--                         refresh_niche_benchmarks() once there is data.
--   • ppl_campaigns     — those rows were admin-created (not seeded), so there
--                         is nothing to restore; recreate any campaigns you
--                         need from /admin.
--
-- Prices are flat per niche / sub-niche (roofing $75, renovation $95, roofing
-- sub-niches $70/$85/$125, renovation sub-niches $95), so per-area rows are
-- seeded by reusing the areas already priced for other niches. Safe to re-run.
-- ============================================================================

-- 1. Base per-niche default price (area null, sub_niche null) --------------
insert into public.ppl_pricing (niche, price_per_lead) values
  ('roofing',    75.00),
  ('renovation', 95.00)
on conflict do nothing;

-- 2. Per-area prices, flat, for every area already priced for another niche
insert into public.ppl_pricing (niche, area, price_per_lead)
select 'roofing', area, 75.00
  from public.ppl_pricing
 where area is not null and sub_niche is null
 group by area
on conflict do nothing;

insert into public.ppl_pricing (niche, area, price_per_lead)
select 'renovation', area, 95.00
  from public.ppl_pricing
 where area is not null and sub_niche is null
 group by area
on conflict do nothing;

-- 3. Sub-niche default prices (area null) ---------------------------------
insert into public.ppl_pricing (niche, sub_niche, price_per_lead) values
  ('roofing',    'all_restorations',  70.00),
  ('roofing',    'all_replacements',  85.00),
  ('roofing',    'tile_metal',       125.00),
  ('renovation', 'kitchen',           95.00),
  ('renovation', 'bathroom',          95.00)
on conflict do nothing;

-- 4. Sub-niche per-area prices (flat), reusing existing areas -------------
insert into public.ppl_pricing (niche, sub_niche, area, price_per_lead)
select v.niche, v.sub_niche, a.area, v.price
  from (values
    ('roofing',    'all_restorations',  70.00::numeric),
    ('roofing',    'all_replacements',  85.00),
    ('roofing',    'tile_metal',       125.00),
    ('renovation', 'kitchen',           95.00),
    ('renovation', 'bathroom',          95.00)
  ) as v(niche, sub_niche, price)
  cross join (
    select distinct area from public.ppl_pricing where area is not null and sub_niche is null
  ) a
on conflict do nothing;

notify pgrst, 'reload schema';
