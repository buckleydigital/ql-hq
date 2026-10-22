// =============================================================================
// meta-capi - a client's bookings, quotes and sales back to their Meta pixel
// =============================================================================
// The client's funnel, back to their pixel so Meta can see which ads bring
// people who book, get quoted and buy. Database triggers call this (through
// send_meta_event) for each step, once per lead:
//   Schedule    an appointment is booked for the lead
//   QuoteSent   a quote to the lead is first sent (a custom event)
//   Purchase    the lead moves to closed_won, with its value
// Only for clients with a pixel ID saved; pay-per-lead leads are never sent.
//
// Not through our Meta app: each client generates a Conversions API token for
// their own pixel in their Events Manager (pixel > Settings > Conversions API >
// Generate access token), and the event is sent with that. The token is kept
// in the vault (company_capi_tokens) and never goes back to a browser. On save
// it is checked against the pixel: companies.meta_dataset_connected is the
// pixel it reached, meta_dataset_error why it couldn't. Until it connects, a
// sale is held, not lost, and goes once it does (within Meta's 7 days).
//
// Meta matches the sale to the person by, best first:
//   lead_id      the instant form's leadgen id, for leads from their Lead Ads
//   em, ph, ...  SHA-256 of email, phone, name, postcode, for any other lead
//
//   POST { action: "send", lead_id, event? }  x-autopilot-secret: the
//                                      triggers (event defaults to Purchase)
//   POST { action: "retry" }           x-autopilot-secret: pg_cron, every 30
//                                      minutes, for events not sent yet
//   POST { action: "test", company_id, test_event_code, lead_id? }
//                                      x-autopilot-secret: a Purchase, timed
//                                      now, to Events Manager's Test events tab
//                                      only (not counted, not recorded here),
//                                      for a lead of theirs or a made-up one
//   POST { action: "state" | "save", company_id?, dataset_id?, token? } signed
//     in: a client for their own company (Settings), or the team for a client
//     (Team Panel, /admin Client Pixels). A blank token leaves the saved one.
//
// Env: META_GRAPH_VERSION, META_TEST_EVENT_CODE (optional: send to Events
// Manager's Test events tab instead).
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { graph } from "../_shared/meta-ads.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MAX_ATTEMPTS = 5;
const EVENTS = ["Schedule", "QuoteSent", "Purchase"];
// Meta refuses events more than 7 days old.
const MAX_AGE_MS = 7 * 86400_000;

type Admin = ReturnType<typeof createClient>;
type Row = Record<string, unknown>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  try {
    const secret = req.headers.get("x-autopilot-secret") || "";
    if (secret) {
      const { data: ok } = await admin.rpc("autopilot_secret_ok", { p: secret });
      if (ok !== true) return json({ error: "unauthorized" }, 401);
      const body = await req.json().catch(() => ({})) as Row;
      if (body.action === "send" && body.lead_id) {
        const event = EVENTS.includes(String(body.event)) ? String(body.event) : "Purchase";
        return json(await send(admin, String(body.lead_id), event));
      }
      if (body.action === "retry") return json(await retry(admin));
      if (body.action === "test" && body.company_id && body.test_event_code) {
        return json(await testSend(admin, String(body.company_id), String(body.test_event_code), body.lead_id ? String(body.lead_id) : null));
      }
      return json({ error: `Unknown action: ${body.action}` }, 400);
    }
    if (req.headers.get("Authorization")) return await signedIn(admin, req);
    return json({ error: "unauthorized" }, 401);
  } catch (err) {
    console.error("meta-capi error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});

async function sha256(v: string): Promise<string> {
  const buf = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Australian numbers as Meta wants them: country code, digits only. */
function phoneDigits(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("61")) return d;
  if (d.startsWith("0")) return "61" + d.slice(1);
  return d.length === 9 ? "61" + d : d;
}

/** The instant form's leadgen id, when the lead came from one of their Lead Ads. */
async function leadgenId(admin: Admin, lead: Row): Promise<string | null> {
  const fromLead = ((lead.custom_data || {}) as Row).meta_lead_id;
  if (fromLead && /^\d+$/.test(String(fromLead))) return String(fromLead);
  const { data } = await admin.from("meta_leads").select("leadgen_id").eq("lead_id", lead.id).limit(1).maybeSingle();
  return (data as Row | null)?.leadgen_id ? String((data as Row).leadgen_id) : null;
}

async function userData(admin: Admin, lead: Row): Promise<{ user: Row; matchedBy: string[] }> {
  const user: Row = {}, matchedBy: string[] = [];
  const gen = await leadgenId(admin, lead);
  // As a string: leadgen ids can be past what a JS number holds exactly.
  if (gen) { user.lead_id = gen; matchedBy.push("lead_id"); }
  const add = async (key: string, raw: unknown, norm: (s: string) => string = (s) => s.trim().toLowerCase()) => {
    const v = typeof raw === "string" ? norm(raw) : "";
    if (!v) return;
    user[key] = [await sha256(v)];
    matchedBy.push(key);
  };
  await add("em", lead.email);
  await add("ph", lead.phone, phoneDigits);
  await add("fn", lead.first_name);
  await add("ln", lead.last_name);
  await add("zp", lead.postcode, (s) => s.replace(/\s/g, "").toLowerCase());
  if (matchedBy.length) user.country = [await sha256("au")];
  user.external_id = [await sha256(String(lead.id))];
  return { user, matchedBy };
}

async function tokenFor(admin: Admin, companyId: string): Promise<string | null> {
  const { data } = await admin.rpc("get_company_capi_token", { p_company: companyId });
  return data ? String(data) : null;
}

/** One funnel step as Meta's event. Only the sale carries the job's value. */
async function funnelEvent(admin: Admin, lead: Row, name: string, at: string, eventId: string) {
  const { user, matchedBy } = await userData(admin, lead);
  const value = name === "Purchase" ? Number(lead.value || 0) : 0;
  const event: Row = {
    event_name: name,
    event_time: Math.floor(new Date(at).getTime() / 1000),
    event_id: eventId,
    action_source: "system_generated",
    user_data: user,
    custom_data: {
      event_source: "crm",
      lead_event_source: "QuoteLeads",
      ...(value > 0 ? { value, currency: "AUD" } : {}),
    },
  };
  return { event, matchedBy, value };
}

/** A Purchase to the Test events tab only, for a lead of theirs or a made-up one. */
async function testSend(admin: Admin, companyId: string, testCode: string, leadId: string | null): Promise<Row> {
  const { data: company } = await admin.from("companies").select("meta_dataset_id").eq("id", companyId).maybeSingle();
  const dataset = (company as Row | null)?.meta_dataset_id ? String((company as Row).meta_dataset_id) : "";
  const token = await tokenFor(admin, companyId);
  if (!dataset || !token) return { ok: false, error: "no pixel ID or token saved" };
  const { data: found } = leadId ? await admin.from("leads").select("*").eq("id", leadId).eq("company_id", companyId).maybeSingle() : { data: null };
  const lead = (found as Row | null) ?? {
    id: `test-${companyId}`, email: "test@quoteleads.com.au", phone: "+61400000000",
    first_name: "Test", last_name: "Customer", postcode: "2000", value: 1000,
  };
  const { event, matchedBy } = await funnelEvent(admin, lead, "Purchase", new Date().toISOString(), `test-${Date.now()}`);
  try {
    const out = await graph(`${dataset}/events`, { token, form: { data: [event], test_event_code: testCode } });
    return { ok: true, meta: out, matched_by: matchedBy, made_up_customer: !found };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** One funnel step for one lead, sent once. Returns what happened. */
async function send(admin: Admin, leadId: string, name: string): Promise<Row> {
  const { data: lead } = await admin.from("leads").select("*").eq("id", leadId).maybeSingle();
  if (!lead) return { ok: true, skipped: "lead not found" };
  const l = lead as Row;
  // A sale reopened before it went isn't a sale; booking and quoting stand.
  if (name === "Purchase" && String(l.pipeline_stage) !== "closed_won") return { ok: true, skipped: "not closed_won" };
  if (l.is_ppl === true) return { ok: true, skipped: "pay-per-lead lead" };
  const { data: company } = await admin.from("companies").select("id, meta_dataset_id, meta_dataset_connected").eq("id", l.company_id).maybeSingle();
  const dataset = (company as Row | null)?.meta_dataset_id ? String((company as Row).meta_dataset_id) : "";
  if (!dataset) return { ok: true, skipped: "no dataset id" };

  const { data: prior } = await admin.from("meta_capi_events").select("*").eq("lead_id", leadId).eq("event_name", name).maybeSingle();
  const p = prior as Row | null;
  if (p?.sent_at) return { ok: true, skipped: "already sent" };

  // No token yet, or it didn't reach this pixel when saved: Meta would refuse
  // it, so hold the sale without using up a try; retry sends it once connected.
  const token = await tokenFor(admin, String(l.company_id));
  if (!token || (company as Row).meta_dataset_connected !== dataset) {
    await admin.from("meta_capi_events").upsert({
      lead_id: leadId, event_name: name, company_id: l.company_id, dataset_id: dataset, attempts: Number(p?.attempts || 0),
      error: token ? "Waiting: the saved token doesn't reach this pixel" : "Waiting for a Conversions API token",
    }, { onConflict: "lead_id,event_name" });
    return { ok: true, sent: false, waiting: true };
  }

  // When it happened: the first try's time, so a retry reports the same moment.
  const eventId = name === "Purchase" ? `closed_won-${leadId}` : `${name.toLowerCase()}-${leadId}`;
  const { event, matchedBy, value } = await funnelEvent(admin, l, name, String(p?.created_at || new Date().toISOString()), eventId);

  let error: string | null = null;
  try {
    const testCode = Deno.env.get("META_TEST_EVENT_CODE");
    await graph(`${dataset}/events`, { token, form: { data: [event], ...(testCode ? { test_event_code: testCode } : {}) } });
  } catch (e) {
    error = (e as Error).message;
  }
  await admin.from("meta_capi_events").upsert({
    lead_id: leadId, company_id: l.company_id, dataset_id: dataset, event_name: name,
    value: value > 0 ? value : null, matched_by: matchedBy,
    sent_at: error ? null : new Date().toISOString(), error, attempts: Number(p?.attempts || 0) + 1,
  }, { onConflict: "lead_id,event_name" });
  if (error) console.warn(`meta-capi: ${name} for lead ${leadId} to dataset ${dataset}: ${error}`);
  return { ok: !error, sent: !error, error, matched_by: matchedBy };
}

/** Events not sent yet, while they're recent enough for Meta to accept. */
async function retry(admin: Admin) {
  const since = new Date(Date.now() - MAX_AGE_MS + 3600_000).toISOString();
  const { data: failed } = await admin.from("meta_capi_events").select("lead_id, event_name").is("sent_at", null)
    .lt("attempts", MAX_ATTEMPTS).gte("created_at", since).order("created_at").limit(50);
  let sent = 0;
  for (const r of (failed ?? []) as Row[]) {
    const out = await send(admin, String(r.lead_id), String(r.event_name));
    if (out.sent) sent++;
    // Reopened, or the dataset ID taken off since: stop trying.
    else if (out.skipped) await admin.from("meta_capi_events").update({ attempts: MAX_ATTEMPTS, error: `Not sent: ${out.skipped}` })
      .eq("lead_id", r.lead_id).eq("event_name", r.event_name);
  }
  return { ok: true, tried: (failed ?? []).length, sent };
}

/**
 * Can this token send events to this pixel? null when it can, else Meta's
 * reason. A token from Events Manager may only send, not read the pixel, so
 * this posts an empty batch: Meta checks the token first and only then objects
 * that the batch is empty, so that objection means the token is allowed, and
 * nothing is recorded.
 */
async function check(dataset: string, token: string): Promise<string | null> {
  try {
    await graph(`${dataset}/events`, { token, form: { data: [] } });
    return null;
  } catch (e) {
    const msg = (e as Error).message;
    return /must be non-empty/i.test(msg) ? null : msg;
  }
}

// ── Settings, Team Panel and /admin: a client's pixel and token ─────────────────

async function signedIn(admin: Admin, req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: "Not authenticated" }, 401);
  const { data: me } = await admin.from("profiles").select("company_id, is_team, is_admin, team_role").eq("id", user.id).maybeSingle();
  const isTeam = me?.is_team === true, isAdmin = me?.is_admin === true;
  const body = await req.json().catch(() => ({})) as Row;
  // A client acts on their own company; only the team names another.
  const companyId = String(body.company_id || me?.company_id || "");
  if (!companyId) return json({ error: "company_id is required" }, 400);
  if (companyId !== me?.company_id && !isAdmin) {
    if (!isTeam) return json({ error: "Forbidden" }, 403);
    if (me?.team_role !== "ops_manager") {
      const { data: assigned } = await admin.from("team_assignments").select("company_id")
        .eq("team_user_id", user.id).eq("company_id", companyId).maybeSingle();
      if (!assigned) return json({ error: "Forbidden: client not assigned to you" }, 403);
    }
  }
  const { data: company } = await admin.from("companies").select("id, meta_dataset_id, meta_dataset_connected, meta_dataset_error")
    .eq("id", companyId).maybeSingle();
  if (!company) return json({ error: "Client not found" }, 404);
  const c = company as Row;

  if (body.action === "save") {
    const id = String(body.dataset_id ?? "").replace(/\s/g, "");
    if (id && !/^\d{6,20}$/.test(id)) return json({ error: "A pixel ID is the number from Events Manager, digits only." }, 400);
    const newToken = String(body.token ?? "").trim();
    if (newToken) await admin.rpc("set_company_capi_token", { p_company: companyId, p_token: newToken });
    const token = newToken || await tokenFor(admin, companyId);
    const problem = !id ? null : !token ? "No Conversions API token saved yet" : await check(id, token);
    const patch = { meta_dataset_id: id || null, meta_dataset_connected: id && !problem ? id : null, meta_dataset_error: problem };
    await admin.from("companies").update(patch).eq("id", companyId);
    Object.assign(c, patch);
  } else if (body.action !== "state") {
    return json({ error: `Unknown action: ${body.action}` }, 400);
  }

  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: recent } = await admin.from("meta_capi_events").select("sent_at, error, attempts, created_at")
    .eq("company_id", companyId).gte("created_at", since).order("created_at", { ascending: false }).limit(500);
  const rows = (recent ?? []) as Row[];
  const lastError = rows.find((r) => !r.sent_at && r.error && !String(r.error).startsWith("Waiting"));
  return json({
    ok: true,
    dataset_id: c.meta_dataset_id ?? null,
    token_saved: !!(await tokenFor(admin, companyId)),
    // The saved token reached this pixel when it was saved.
    dataset_connected: !!c.meta_dataset_id && c.meta_dataset_connected === c.meta_dataset_id,
    dataset_error: c.meta_dataset_error ?? null,
    last_30_days: {
      sent: rows.filter((r) => r.sent_at).length,
      held: rows.filter((r) => !r.sent_at && String(r.error ?? "").startsWith("Waiting")).length,
      failed: rows.filter((r) => !r.sent_at && !String(r.error ?? "").startsWith("Waiting")).length,
    },
    last_sent_at: rows.find((r) => r.sent_at)?.sent_at ?? null,
    last_error: lastError ? String(lastError.error) : null,
  });
}
