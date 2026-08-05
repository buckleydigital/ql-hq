-- Set the maximum PPL order to 100 leads. Remove the 200 and 300 packs,
-- leaving 25/50/100. Orders snapshot quantity + discount at purchase time
-- and do not reference tier ids, so deleting these rows is safe. The
-- /admin discount editor and the buy-leads page both read this table live.

delete from public.volume_discount_tiers
where min_quantity in (200, 300);

-- Existing per-row max_order_qty overrides above 100 are no longer
-- reachable now that the app enforces a 100-lead maximum, but clamp them
-- here too so /admin shows accurate values.
update public.ppl_pricing
set max_order_qty = 100
where max_order_qty > 100;
