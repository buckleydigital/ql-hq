// The niches Pay Per Lead sells. Pricing and both checkouts refuse anything
// else, whatever rows ppl_pricing still holds. Niches are normalised the way
// the functions do it: lower case, hyphens as underscores.
export const PPL_NICHES = ['solar_battery', 'battery_retrofit', 'hvac']

export function isPplNiche(niche: string | null | undefined): boolean {
  return PPL_NICHES.includes(niche ?? '')
}

// Order minimums. A first order is a trial of at least 50 leads; anyone who
// has paid for leads before re-orders at least 100. The cap per order is
// separate (max_order_qty, ceiling 100).
export const PPL_TRIAL_MIN = 50
export const PPL_REORDER_MIN = 100

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
