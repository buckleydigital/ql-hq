-- Add three Victorian regional areas — Bendigo, Ballarat, Warragul — to the
-- Solar, Solar & Battery, and Battery Retrofit niches. Prices match each
-- niche's existing Victoria pricing (Melbourne/Geelong): Solar $85,
-- Solar & Battery $90, Battery Retrofit $90. Admin can adjust rows in /admin.
-- Safe to re-run (on conflict do nothing).

insert into ppl_pricing (niche, area, price_per_lead) values
  ('solar','Bendigo',85.00),
  ('solar','Ballarat',85.00),
  ('solar','Warragul',85.00),

  ('solar_battery','Bendigo',90.00),
  ('solar_battery','Ballarat',90.00),
  ('solar_battery','Warragul',90.00),

  ('battery_retrofit','Bendigo',90.00),
  ('battery_retrofit','Ballarat',90.00),
  ('battery_retrofit','Warragul',90.00)

on conflict do nothing;
