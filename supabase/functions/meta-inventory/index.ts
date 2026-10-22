// =============================================================================
// meta-inventory - what the QuoteLeads Business Manager can see in Meta
// =============================================================================
// Read-only in Meta. Lists every ad account and Page shared with the QuoteLeads
// Business Manager or owned by it, and the pixels on each ad account, and
// saves them to meta_assets so the team can see, per client, which ad account,
// Page and pixel are theirs. A pixel with no owner business is one Meta won't
// issue a Conversions API token for, until it's in a business portfolio.
//
// Saving never touches company_id / match_confirmed: matching to clients is
// done afterwards and kept across refreshes.
//
// POST {} with the x-watch-secret header (the vault's meta_watch_secret).
//
// Env: META_ACCESS_TOKEN (system user), META_BUSINESS_ID, META_GRAPH_VERSION.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const BUSINESS_ID = Deno.env.get("META_BUSINESS_ID") || "1065750507426304";
const GRAPH = `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") || "v23.0"}`;

type Row = Record<string, unknown>;
type GraphError = { message: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json" } });
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

// Every page of a Graph edge. Meta's paging.next links carry the token already.
async function graphList(path: string, token: string): Promise<{ data: Row[]; error?: GraphError }> {
  const out: Row[] = [];
  let url: string | null = `${GRAPH}/${path}${path.includes("?") ? "&" : "?"}limit=100&access_token=${encodeURIComponent(token)}`;
  for (let i = 0; url && i < 20; i++) {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({})) as Row;
    if (!res.ok || body.error) return { data: out, error: (body.error as GraphError) ?? { message: `HTTP ${res.status}` } };
    out.push(...((body.data as Row[]) ?? []));
    url = ((body.paging as Row | undefined)?.next as string | undefined) ?? null;
  }
  return { data: out };
}

Deno.serve(async (req: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  const presented = req.headers.get("x-watch-secret") || "";
  const { data: authorised } = presented ? await admin.rpc("meta_watch_secret_ok", { p: presented }) : { data: false };
  if (authorised !== true) return json({ error: "unauthorized" }, 401);
  const token = Deno.env.get("META_ACCESS_TOKEN");
  if (!token) return json({ error: "META_ACCESS_TOKEN not configured" }, 500);

  const accFields = "account_id,name,account_status,currency,business{id,name}";
  const [sharedAcc, ownedAcc, sharedPages, ownedPages] = await Promise.all([
    graphList(`${BUSINESS_ID}/client_ad_accounts?fields=${accFields}`, token),
    graphList(`${BUSINESS_ID}/owned_ad_accounts?fields=${accFields}`, token),
    graphList(`${BUSINESS_ID}/client_pages?fields=id,name,link`, token),
    graphList(`${BUSINESS_ID}/owned_pages?fields=id,name,link`, token),
  ]);
  const errors = [sharedAcc, ownedAcc, sharedPages, ownedPages].map((r) => r.error?.message).filter(Boolean);
  const now = new Date().toISOString();
  const rows: Row[] = [];

  const accounts = [...sharedAcc.data.map((a) => ({ ...a, shared: true })), ...ownedAcc.data.map((a) => ({ ...a, shared: false }))];
  for (const a of accounts) {
    const accId = digits(a.account_id);
    const biz = (a.business || {}) as Row;
    rows.push({
      kind: "ad_account", meta_id: accId, name: a.name ?? null,
      business_id: biz.id ? String(biz.id) : null, business_name: biz.name ? String(biz.name) : null,
      owner_business_id: biz.id ? String(biz.id) : null, ad_account_id: accId,
      details: { account_status: a.account_status, currency: a.currency, shared_with_us: a.shared }, seen_at: now,
    });
    // The pixels on this ad account, and who owns each one.
    const px = await graphList(`act_${accId}/adspixels?fields=id,name,owner_business{id,name},last_fired_time`, token);
    if (px.error) errors.push(`pixels on ${accId}: ${px.error.message}`);
    for (const p of px.data) {
      const owner = (p.owner_business || {}) as Row;
      rows.push({
        kind: "pixel", meta_id: String(p.id), name: p.name ?? null,
        business_id: biz.id ? String(biz.id) : null, business_name: biz.name ? String(biz.name) : null,
        owner_business_id: owner.id ? String(owner.id) : null, ad_account_id: accId,
        details: { owner_business_name: owner.name ?? null, last_fired_time: p.last_fired_time ?? null }, seen_at: now,
      });
    }
  }
  const pages = [...sharedPages.data.map((p) => ({ ...p, shared: true })), ...ownedPages.data.map((p) => ({ ...p, shared: false }))];
  for (const p of pages) {
    rows.push({
      kind: "page", meta_id: String(p.id), name: p.name ?? null, business_id: null, business_name: null,
      owner_business_id: null, ad_account_id: null, details: { link: p.link ?? null, shared_with_us: p.shared }, seen_at: now,
    });
  }

  // A pixel on two ad accounts is one row; the last ad account seen wins.
  const unique = new Map(rows.map((r) => [`${r.kind}:${r.meta_id}`, r]));
  const { error } = await admin.from("meta_assets").upsert([...unique.values()], { onConflict: "kind,meta_id" });
  if (error) return json({ ok: false, error: error.message, errors }, 500);
  return json({
    ok: true, errors,
    ad_accounts: accounts.length, pages: pages.length,
    pixels: [...unique.values()].filter((r) => r.kind === "pixel").length,
  });
});
