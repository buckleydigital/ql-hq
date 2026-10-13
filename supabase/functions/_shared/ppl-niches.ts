// The niches Pay Per Lead sells. Pricing and both checkouts refuse anything
// else, whatever rows ppl_pricing still holds. Niches are normalised the way
// the functions do it: lower case, hyphens as underscores.
export const PPL_NICHES = ['solar_battery', 'battery_retrofit', 'hvac']

export function isPplNiche(niche: string | null | undefined): boolean {
  return PPL_NICHES.includes(niche ?? '')
}
