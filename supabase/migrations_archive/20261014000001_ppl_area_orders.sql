-- One pay-per-lead order per area, delivered by postcode.
--
-- A buyer can put up to five suburbs (radius areas) on one checkout. Each one
-- becomes its own ppl_lead_orders row with its own price (its nearest city's),
-- its own quantity (up to 100), and its own list of postcodes. A postcode-list
-- order is one area capped at 100; a state-wide order is one area capped at
-- 300. A delivered lead counts against the active order whose postcodes hold
-- the lead's postcode, so each area fills on its own.
--
-- Radius areas are turned into postcodes from au_postcode_points: every
-- postcode with a point inside the circle is in. The points are GeoNames'
-- Australian postal code data (https://www.geonames.org, CC BY 4.0), one row
-- per distinct location, loaded by the companion data migrations.

create table if not exists public.au_postcode_points (
  postcode text not null,
  state    text not null,
  lat      numeric(7,3) not null,
  lng      numeric(7,3) not null,
  primary key (postcode, lat, lng)
);
create index if not exists au_postcode_points_lat_lng on public.au_postcode_points (lat, lng);
create index if not exists au_postcode_points_state on public.au_postcode_points (state);
alter table public.au_postcode_points enable row level security;
comment on table public.au_postcode_points is
  'Australian postcode locations from GeoNames (geonames.org), CC BY 4.0. Used to turn a pay-per-lead radius into postcodes.';

-- Postcodes with any point within p_km of a centre (great-circle distance).
create or replace function public.ppl_postcodes_within(p_lat double precision, p_lng double precision, p_km double precision)
returns text[]
language sql stable
set search_path = public
as $$
  select coalesce(array_agg(distinct postcode order by postcode), '{}')
  from public.au_postcode_points
  where lat between p_lat - p_km / 111.0 and p_lat + p_km / 111.0
    and lng between p_lng - p_km / (111.0 * cos(radians(p_lat))) and p_lng + p_km / (111.0 * cos(radians(p_lat)))
    and 2 * 6371 * asin(sqrt(
          power(sin(radians(lat::double precision - p_lat) / 2), 2) +
          cos(radians(p_lat)) * cos(radians(lat::double precision)) *
          power(sin(radians(lng::double precision - p_lng) / 2), 2)
        )) <= p_km
$$;

-- Every postcode in a state, by its name as the order form shows it.
create or replace function public.ppl_postcodes_in_state(p_state text)
returns text[]
language sql stable
set search_path = public
as $$
  select coalesce(array_agg(distinct postcode order by postcode), '{}')
  from public.au_postcode_points
  where state = case lower(trim(p_state))
    when 'queensland' then 'QLD'
    when 'new south wales' then 'NSW'
    when 'victoria' then 'VIC'
    when 'western australia' then 'WA'
    when 'south australia' then 'SA'
    when 'australian capital territory' then 'ACT'
    when 'tasmania' then 'TAS'
    when 'northern territory' then 'NT'
    else upper(trim(p_state)) end
$$;

revoke all on function public.ppl_postcodes_within(double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.ppl_postcodes_in_state(text) from public, anon, authenticated;

-- The area an order delivers to. Null on orders from before areas were split
-- out; those keep being counted oldest-first as before.
alter table public.ppl_lead_orders add column if not exists postcodes text[];
create index if not exists ppl_lead_orders_postcodes on public.ppl_lead_orders using gin (postcodes);

-- The priced, per-area breakdown of a website signup, held until payment so
-- the webhook can create one order per area.
alter table public.signup_attempts add column if not exists areas jsonb;

-- Count a delivered lead against the area it came from: the oldest active
-- order whose postcodes hold the lead's postcode. Leads that match no area
-- (or companies with only older, unsplit orders) fall back to the oldest
-- active order, as before, so nothing delivered goes uncounted.
create or replace function public.increment_ppl_order_delivered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id           uuid;
  v_total              int;
  v_new_delivered      int;
  v_lead_order_id      uuid;
  v_lead_quantity      int;
  v_new_lead_delivered int;
  v_postcode           text := nullif(trim(coalesce(NEW.postcode, '')), '');
begin
  -- Only act when is_ppl transitions false → true (or NULL → true)
  if not (
    NEW.is_ppl = true and
    (TG_OP = 'INSERT' or coalesce(OLD.is_ppl, false) = false)
  ) then
    return NEW;
  end if;

  -- ── ppl_orders (admin fulfillment tracker) — behaviour unchanged ──────────
  select id, total_leads
  into v_order_id, v_total
  from public.ppl_orders
  where company_id = NEW.company_id
    and status = 'active'
  order by purchased_at asc
  limit 1;

  if v_order_id is not null then
    update public.ppl_orders
    set delivered_leads = delivered_leads + 1,
        updated_at      = now()
    where id = v_order_id
    returning delivered_leads into v_new_delivered;

    -- Auto-complete when fully delivered
    if v_new_delivered >= v_total then
      update public.ppl_orders
      set status     = 'completed',
          updated_at = now()
      where id = v_order_id;
    end if;
  end if;

  -- ── ppl_lead_orders (client dashboard order) ──────────────────────────────
  -- First the area the lead is in.
  if v_postcode is not null then
    select id, quantity
    into v_lead_order_id, v_lead_quantity
    from public.ppl_lead_orders
    where company_id = NEW.company_id
      and status = 'active'
      and delivered_count < quantity
      and postcodes @> array[v_postcode]
    order by created_at asc
    limit 1;
  end if;

  -- Otherwise the oldest active order, preferring older unsplit orders.
  if v_lead_order_id is null then
    select id, quantity
    into v_lead_order_id, v_lead_quantity
    from public.ppl_lead_orders
    where company_id = NEW.company_id
      and status = 'active'
      and delivered_count < quantity
    order by (postcodes is not null), created_at asc
    limit 1;
  end if;

  if v_lead_order_id is not null then
    update public.ppl_lead_orders
    set delivered_count = delivered_count + 1,
        updated_at      = now()
    where id = v_lead_order_id
    returning delivered_count into v_new_lead_delivered;

    -- Auto-mark fulfilled when the pack is fully delivered
    if v_new_lead_delivered >= v_lead_quantity then
      update public.ppl_lead_orders
      set status     = 'fulfilled',
          updated_at = now()
      where id = v_lead_order_id;
    end if;
  end if;

  return NEW;
end;
$$;

-- For Mission Control's routing: the postcodes each company still has room in.
-- A company is included once it has an order split into areas, and stays
-- included (with an empty list once every area is full) so Mission Control
-- stops routing to it. A company with an older unsplit order still active is
-- left out, so the postcodes set by hand in Mission Control stay as they are.
create or replace function public.ppl_open_area_postcodes()
returns table (company_id uuid, postcodes text[])
language sql stable
security definer
set search_path = public
as $$
  select o.company_id,
         coalesce(array_agg(distinct pc order by pc)
                    filter (where o.status = 'active' and o.delivered_count < o.quantity and pc is not null), '{}')
  from public.ppl_lead_orders o
  left join lateral unnest(o.postcodes) pc on true
  where o.status in ('active', 'fulfilled')
  group by o.company_id
  having bool_or(o.postcodes is not null)
     and not bool_or(o.status = 'active' and o.postcodes is null)
$$;
revoke all on function public.ppl_open_area_postcodes() from public, anon, authenticated;
