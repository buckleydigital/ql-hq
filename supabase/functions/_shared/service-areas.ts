// Suburbs on a pay-per-lead radius order: each a centre point plus its own
// travel radius. Sent by the buy-leads form, kept on signup_attempts until
// payment, then on ppl_lead_orders.service_areas.

export type ServiceArea = { label: string; lat: number; lng: number; radius_km: number };

const MAX_AREAS = 5;
const ALLOWED_KM = [50, 75, 100];

// Never trust the browser: keep only well-formed entries inside Australia,
// snap the radius to an option the form offers, and cap the count.
export function cleanServiceAreas(raw: unknown): ServiceArea[] {
  if (!Array.isArray(raw)) return [];
  const out: ServiceArea[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const label = String(r.label ?? "").replace(/[<>]/g, "").trim().slice(0, 100);
    const lat = Number(r.lat), lng = Number(r.lng);
    const km = Number(r.radius_km);
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -44.5 || lat > -9 || lng < 112 || lng > 154.5) continue;
    const radius_km = ALLOWED_KM.reduce((best, k) => Math.abs(k - km) < Math.abs(best - km) ? k : best, 50);
    out.push({ label, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, radius_km });
    if (out.length >= MAX_AREAS) break;
  }
  return out;
}

// "Carindale QLD 4152 (50km); Logan Central QLD (75km)"
export function summariseServiceAreas(areas: ServiceArea[] | null | undefined): string {
  return (areas || []).map((a) => `${a.label} (${a.radius_km}km)`).join("; ");
}
