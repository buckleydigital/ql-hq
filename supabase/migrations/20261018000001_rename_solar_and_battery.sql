-- Pay per lead: the Solar + Battery niche is now solar_and_battery (was
-- solar_battery), so it can't be mistaken for battery_retrofit. Prices,
-- orders, companies and signup attempts move to the new name. The functions
-- still accept solar_battery from an old page and treat it as the new one.
update public.ppl_pricing     set niche = 'solar_and_battery' where niche = 'solar_battery';
update public.ppl_lead_orders set niche = 'solar_and_battery' where niche = 'solar_battery';
update public.companies       set niche = 'solar_and_battery' where niche = 'solar_battery';
update public.signup_attempts set niche = 'solar_and_battery' where niche = 'solar_battery';
