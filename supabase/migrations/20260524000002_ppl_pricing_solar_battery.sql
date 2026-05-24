-- Add Solar Battery niche pricing — default row + all 46 AU cities.
-- Default price: $90/lead. Admin can adjust individual rows in /admin.

insert into ppl_pricing (niche, area, price_per_lead) values
  -- Default (all areas)
  ('solar_battery', null, 90.00),

  -- Solar Battery ($90)
  ('solar_battery','Brisbane',90.00),('solar_battery','Gold Coast',90.00),('solar_battery','Sunshine Coast',90.00),
  ('solar_battery','Toowoomba',90.00),('solar_battery','Townsville',90.00),('solar_battery','Cairns',90.00),
  ('solar_battery','Rockhampton',90.00),('solar_battery','Bundaberg',90.00),('solar_battery','Mackay',90.00),
  ('solar_battery','Hervey Bay',90.00),
  ('solar_battery','Sydney',90.00),('solar_battery','Newcastle',90.00),('solar_battery','Wollongong',90.00),
  ('solar_battery','Central Coast',90.00),('solar_battery','Coffs Harbour',90.00),('solar_battery','Port Macquarie',90.00),
  ('solar_battery','Tamworth',90.00),('solar_battery','Wagga Wagga',90.00),('solar_battery','Albury',90.00),
  ('solar_battery','Dubbo',90.00),('solar_battery','Bathurst',90.00),('solar_battery','Orange',90.00),
  ('solar_battery','Melbourne',90.00),('solar_battery','Geelong',90.00),('solar_battery','Ballarat',90.00),
  ('solar_battery','Bendigo',90.00),('solar_battery','Shepparton',90.00),('solar_battery','Mildura',90.00),
  ('solar_battery','Warrnambool',90.00),('solar_battery','Wodonga',90.00),
  ('solar_battery','Perth',90.00),('solar_battery','Mandurah',90.00),('solar_battery','Bunbury',90.00),
  ('solar_battery','Geraldton',90.00),('solar_battery','Kalgoorlie',90.00),
  ('solar_battery','Adelaide',90.00),('solar_battery','Mount Gambier',90.00),('solar_battery','Whyalla',90.00),
  ('solar_battery','Port Augusta',90.00),
  ('solar_battery','Canberra',90.00),
  ('solar_battery','Hobart',90.00),('solar_battery','Launceston',90.00),('solar_battery','Devonport',90.00),('solar_battery','Burnie',90.00),
  ('solar_battery','Darwin',90.00),('solar_battery','Alice Springs',90.00)

on conflict do nothing;
