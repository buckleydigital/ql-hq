-- Retire the old PPL niches: 'solar' (All Solar), 'roofing' and 'renovation'
-- are no longer sold, so their price rows only cluttered the admin Pricing tab.
-- None have orders or campaigns.
delete from public.ppl_pricing where niche in ('solar', 'roofing', 'renovation');
