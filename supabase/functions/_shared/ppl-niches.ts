// The niches Pay Per Lead sells. Pricing and both checkouts refuse anything
// else, whatever rows ppl_pricing still holds. Niches are normalised the way
// the functions do it: lower case, hyphens as underscores.
export const PPL_NICHES = ['solar_battery', 'battery_retrofit', 'hvac']

export function isPplNiche(niche: string | null | undefined): boolean {
  return PPL_NICHES.includes(niche ?? '')
}

// Order minimums. A first order is a trial of at least 25 leads; anyone who
// has paid for leads before re-orders at least 25, per area. The cap per
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
