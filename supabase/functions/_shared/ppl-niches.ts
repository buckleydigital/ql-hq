// The niches Pay Per Lead sells. Pricing and both checkouts refuse anything
// else, whatever rows ppl_pricing still holds. Niches are normalised the way
// the functions do it: lower case, hyphens as underscores.
export const PPL_NICHES = ['solar_and_battery', 'battery_retrofit', 'hvac']

// A niche as the functions compare it: lower case, underscores. solar_battery
// was the old name for solar_and_battery and is still accepted from a page
// that was loaded before the rename.
export function normalisePplNiche(raw: unknown): string {
  const n = String(raw ?? '').toLowerCase().trim().replace(/-/g, '_')
  return n === 'solar_battery' ? 'solar_and_battery' : n
}

export function isPplNiche(niche: string | null | undefined): boolean {
  return PPL_NICHES.includes(niche ?? '')
}

// Order minimums, per area. First orders and re-orders are both 25 for now;
// they stay separate so either can change on its own. The cap per
// area is separate (ppl-areas.ts: 100, or 300 state wide, and max_order_qty).
export const PPL_TRIAL_MIN = 25
export const PPL_REORDER_MIN = 25

// deno-lint-ignore no-explicit-any
export async function pplMinQuantity(db: any, companyId: string | null | undefined): Promise<number> {
  if (!companyId) return PPL_TRIAL_MIN
  const [current, legacy] = await Promise.all([
    db.from('ppl_lead_orders').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).in('status', ['active', 'fulfilled', 'completed']),
    db.from('ppl_orders').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).in('status', ['active', 'completed']),
  ])
  return (current.count ?? 0) + (legacy.count ?? 0) > 0 ? PPL_REORDER_MIN : PPL_TRIAL_MIN
}

// HVAC is sold as one lead type, split & ducted installs. Every HVAC order
// carries that sub-niche whatever the page sent, so the order, the receipt,
// the emails and Mission Control all say what the client is getting.
const PPL_FIXED_SUB_NICHE: Record<string, string> = { hvac: 'split_ducted' }

export function pplSubNiche(niche: string, subNiche: string | null): string | null {
  return PPL_FIXED_SUB_NICHE[niche] ?? subNiche
}

// How a niche (and sub-niche) reads to a client: on the Stripe receipt and in
// emails.
const PPL_LABELS: Record<string, string> = {
  solar_and_battery: 'Solar + Battery',
  solar_battery: 'Solar + Battery',
  battery_retrofit: 'Battery Retrofit',
  hvac: 'HVAC',
  split_ducted: 'Split & Ducted',
}

export function pplNicheDisplay(niche: string | null | undefined, subNiche?: string | null): string {
  const label = (s: string) => PPL_LABELS[s] ?? s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  if (!niche) return ''
  return subNiche ? `${label(niche)} (${label(subNiche)})` : label(niche)
}
