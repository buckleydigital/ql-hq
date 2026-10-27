-- The font a client's ads are drawn in, picked in the Team Panel's creative
-- studio. Null is the default, Poppins.
alter table public.companies add column if not exists brand_font text;
