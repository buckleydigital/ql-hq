// The ledger of signed upload links (public.media_uploads). An upload link is
// only ever handed out after reserveUpload() has written its row, and a file
// only joins a library after claimUpload() matches it, so:
//   - caps count uploads still in flight, not just finished ones;
//   - one client can't ask for links faster than RATE_PER_HOUR;
//   - media-cleanup can delete every file that was started and never finished.
import type { createClient } from "npm:@supabase/supabase-js@2";

type Admin = ReturnType<typeof createClient>;
type Row = Record<string, unknown>;

const RATE_PER_HOUR = 120;
const MAX_IN_FLIGHT = 20;
const IN_FLIGHT_WINDOW_MS = 6 * 3600 * 1000;

/** Uploads started for this company (or stock, when null) and not finished. */
export async function inFlight(admin: Admin, companyId: string | null, kind?: string): Promise<number> {
  let q = admin.from("media_uploads").select("key", { count: "exact", head: true })
    .is("finished_at", null).gte("created_at", new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString());
  q = companyId ? q.eq("company_id", companyId) : q.is("company_id", null);
  if (kind) q = q.eq("kind", kind);
  const { count } = await q;
  return count ?? 0;
}

/** Record a link before handing it out; an error string means don't. */
export async function reserveUpload(admin: Admin, r: {
  key: string; companyId: string | null; kind: string; bytes: number; contentType: string; userId: string;
}): Promise<string | null> {
  let q = admin.from("media_uploads").select("key", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 3600 * 1000).toISOString());
  q = r.companyId ? q.eq("company_id", r.companyId) : q.is("company_id", null);
  const { count: lastHour } = await q;
  if ((lastHour ?? 0) >= RATE_PER_HOUR) return "That's a lot of uploads in an hour. Please try again later.";
  if (await inFlight(admin, r.companyId) >= MAX_IN_FLIGHT) return "Too many uploads are still in progress. Let them finish, then try again.";
  const { error } = await admin.from("media_uploads").insert({
    key: r.key, company_id: r.companyId, kind: r.kind, bytes: r.bytes, content_type: r.contentType, created_by: r.userId,
  });
  return error ? error.message : null;
}

/** The unfinished ledger row for this key and owner, marked finished; or null. */
export async function claimUpload(admin: Admin, key: string, companyId: string | null): Promise<Row | null> {
  let q = admin.from("media_uploads").update({ finished_at: new Date().toISOString() })
    .eq("key", key).is("finished_at", null);
  q = companyId ? q.eq("company_id", companyId) : q.is("company_id", null);
  const { data } = await q.select("key, kind, bytes, content_type").maybeSingle();
  return (data as Row | null) ?? null;
}
