// A pay-per-lead order, split into areas. Each area becomes its own
// ppl_lead_orders row with its own price, quantity and postcodes, so it is
// delivered and counted on its own (see migration 20261014000001):
//
//   radius     up to 5 suburbs, each with its own radius; each is an area,
//              priced at its nearest city and capped at 100 leads
//   postcodes  one area, the buyer's list, capped at 100
//   statewide  one area, the whole state, capped at 300
//
// The quantity the buyer picks is per area. Prices, caps, minimums and
// discounts are all worked out here from the database, never the browser.
import { cleanServiceAreas, type ServiceArea } from './service-areas.ts'

// The cities the order form offers, with the point each one is priced from.
// The dashboard (BL_CITIES) and website (COV_CITIES) carry the same list.
export const PPL_CITY_POINTS: Record<string, [number, number]> = {
  'Brisbane': [-27.4698, 153.0251], 'Gold Coast': [-28.0167, 153.4000], 'Sunshine Coast': [-26.6500, 153.0667],
  'Toowoomba': [-27.5598, 151.9507], 'Cairns': [-16.9186, 145.7781], 'Rockhampton': [-23.3781, 150.5136],
  'Bundaberg': [-24.8661, 152.3489], 'Hervey Bay': [-25.2882, 152.8531],
  'Sydney': [-33.8688, 151.2093], 'Newcastle': [-32.9283, 151.7817], 'Wollongong': [-34.4278, 150.8931],
  'Central Coast': [-33.4269, 151.3417], 'Albury/Wodonga': [-36.0737, 146.9135], 'Tamworth': [-31.0927, 150.9320],
  'Coffs Harbour': [-30.2963, 153.1135], 'Port Macquarie': [-31.4333, 152.9000],
  'Melbourne': [-37.8136, 144.9631], 'Geelong': [-38.1499, 144.3617], 'Shepparton': [-36.3833, 145.4000],
  'Mildura': [-34.2080, 142.1246], 'Frankston / Mornington Peninsula': [-38.1440, 145.1260], 'Dandenong': [-37.9870, 145.2140],
  'Bendigo': [-36.7570, 144.2794], 'Ballarat': [-37.5622, 143.8503], 'Warragul': [-38.1590, 145.9310],
  'Perth': [-31.9505, 115.8605], 'Mandurah': [-32.5269, 115.7217], 'Bunbury': [-33.3271, 115.6414],
  'Adelaide': [-34.9285, 138.6007], 'Canberra': [-35.2809, 149.1300],
}

export const PPL_AREA_CAP = { radius: 100, postcodes: 100, statewide: 300 } as const

function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => d * Math.PI / 180
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// The city a suburb is priced at: the nearest one on the order form.
export function nearestPplCity(lat: number, lng: number): string {
  let best = 'Sydney', bestKm = Infinity
  for (const [city, [cLat, cLng]] of Object.entries(PPL_CITY_POINTS)) {
    const d = km(lat, lng, cLat, cLng)
    if (d < bestKm) { best = city; bestKm = d }
  }
  return best
}

// Price row for a niche in a city: sub-niche + city, sub-niche default,
// niche + city, niche default.
// deno-lint-ignore no-explicit-any
export async function resolvePplPrice(db: any, niche: string, subNiche: string | null, city: string) {
  const { data: rows } = await db
    .from('ppl_pricing')
    .select('price_per_lead, sub_niche, area, max_order_qty, sold_out')
    .eq('niche', niche)
  if (!rows?.length) return null
  // deno-lint-ignore no-explicit-any
  const match = (sn: string | null, a: string | null) => rows.find((r: any) =>
    (sn === null ? !r.sub_niche : r.sub_niche === sn) &&
    (a === null ? !r.area : String(r.area || '').toLowerCase() === a.toLowerCase())
  ) ?? null
  return (subNiche ? match(subNiche, city) : null) ??
    (subNiche ? match(subNiche, null) : null) ??
    match(null, city) ??
    match(null, null)
}

export type PplArea = {
  label: string                 // what the buyer sees: "Carindale QLD (50km)", "Queensland (state wide)"
  location_type: 'radius' | 'postcodes' | 'statewide'
  city: string                  // the city (or state) it is priced at
  lat: number | null
  lng: number | null
  radius_km: number | null
  service_area: ServiceArea | null
  postcode_list: string | null  // the buyer's own list, as typed
  postcodes: string[]           // what it delivers to
  quantity: number
  price_per_lead: number
  discount_percent: number
  total_amount: number          // ex GST, after discount
}

export type PplAreaInput = {
  niche: string                 // normalised: lower case, underscores
  subNiche: string | null
  areaCity: string              // the city (or state) picked on the form
  locationType: string | null
  radiusKm: number | null
  postcodeList: string | null
  serviceAreas: unknown
  quantity: number              // per area
  minQuantity: number
}

// Splits an order into priced areas, or throws a message fit to show the buyer.
// deno-lint-ignore no-explicit-any
export async function buildPplAreas(db: any, input: PplAreaInput): Promise<PplArea[]> {
  const qty = Math.floor(Number(input.quantity))
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Choose how many leads you want')

  const { data: tiers } = await db
    .from('volume_discount_tiers').select('min_quantity, discount_percent').eq('active', true)
  // deno-lint-ignore no-explicit-any
  const discountFor = (q: number) => ((tiers || []) as any[])
    .filter((t) => t.min_quantity <= q)
    .sort((a, b) => b.min_quantity - a.min_quantity)[0]?.discount_percent ?? 0

  type Draft = Omit<PplArea, 'quantity' | 'price_per_lead' | 'discount_percent' | 'total_amount'>
  const drafts: Draft[] = []
  const type = input.locationType === 'statewide' || input.locationType === 'postcodes' ? input.locationType : 'radius'

  if (type === 'statewide') {
    const { data: pcs, error } = await db.rpc('ppl_postcodes_in_state', { p_state: input.areaCity })
    if (error) throw new Error(`Could not look up ${input.areaCity}: ${error.message}`)
    drafts.push({
      label: `${input.areaCity} (state wide)`, location_type: 'statewide', city: input.areaCity,
      lat: null, lng: null, radius_km: null, service_area: null, postcode_list: null, postcodes: pcs || [],
    })
  } else if (type === 'postcodes') {
    const pcs = [...new Set(String(input.postcodeList || '').split(/[\s,;\n]+/).map((p) => p.trim()).filter((p) => /^\d{4}$/.test(p)))]
    if (!pcs.length) throw new Error('Add at least one 4-digit postcode')
    drafts.push({
      label: `${pcs.length} postcode${pcs.length === 1 ? '' : 's'}`, location_type: 'postcodes', city: input.areaCity,
      lat: null, lng: null, radius_km: null, service_area: null, postcode_list: pcs.join(' '), postcodes: pcs,
    })
  } else {
    let areas = cleanServiceAreas(input.serviceAreas)
    if (!areas.length) {
      const centre = PPL_CITY_POINTS[input.areaCity]
      if (!centre) throw new Error(`Pick a suburb for ${input.areaCity}`)
      const r = [50, 75, 100].includes(Number(input.radiusKm)) ? Number(input.radiusKm) : 50
      areas = [{ label: `${input.areaCity} (city centre)`, lat: centre[0], lng: centre[1], radius_km: r }]
    }
    for (const a of areas) {
      const { data: pcs, error } = await db.rpc('ppl_postcodes_within', { p_lat: a.lat, p_lng: a.lng, p_km: a.radius_km })
      if (error) throw new Error(`Could not look up ${a.label}: ${error.message}`)
      drafts.push({
        label: `${a.label} (${a.radius_km}km)`, location_type: 'radius',
        city: PPL_CITY_POINTS[input.areaCity] && /\(city centre\)$/.test(a.label) ? input.areaCity : nearestPplCity(a.lat, a.lng),
        lat: a.lat, lng: a.lng, radius_km: a.radius_km, service_area: a, postcode_list: null, postcodes: pcs || [],
      })
    }
  }

  const out: PplArea[] = []
  for (const d of drafts) {
    if (!d.postcodes.length) throw new Error(`No postcodes found for ${d.label}. Try a different suburb or a wider radius.`)
    const pricing = await resolvePplPrice(db, input.niche, input.subNiche, d.city)
    if (!pricing) throw new Error(`No price is set for ${d.city}`)
    if (pricing.sold_out === true) throw new Error(`${d.city} is sold out for this trade at the moment`)
    const typeCap = PPL_AREA_CAP[d.location_type]
    const cap = Math.min(pricing.max_order_qty ?? typeCap, typeCap)
    if (qty > cap) throw new Error(`Up to ${cap} leads per order for ${d.label}`)
    if (qty < input.minQuantity) throw new Error(`The minimum is ${input.minQuantity} leads per area`)
    const price = Number(pricing.price_per_lead)
    const discount = discountFor(qty)
    out.push({
      ...d, quantity: qty, price_per_lead: price, discount_percent: discount,
      total_amount: Math.round(price * qty * (1 - discount / 100) * 100) / 100,
    })
  }
  return out
}

// "Carindale QLD (50km), Logan Central QLD (75km)"
export function summarisePplAreas(areas: Pick<PplArea, 'label'>[]): string {
  return areas.map((a) => a.label).join(', ')
}
