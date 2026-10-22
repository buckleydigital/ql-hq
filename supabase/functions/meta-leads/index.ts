// =============================================================================
// meta-leads - Meta pushes each lead here the moment a client's form is sent
// =============================================================================
// The webhook end of instant leads (Meta's "leadgen" field on the Page
// object). For every lead from a client's Page:
//
//   Make clients (the default)   recorded only: Make picks the lead up and
//                                runs their integrations, so delivering it
//                                here too would send it twice
//   direct clients               the lead is read from Meta and delivered
//                                through intake-lead at once, like any other
//                                lead; the first one ticks First lead
//
// The team switches a client with campaign_settings.lead_delivery
// ("make" | "direct") from the Campaign section of the Team Panel.
//
// Nothing is taken on trust: a webhook is checked against the app secret when
// META_APP_SECRET is set, and a lead is only ever read back from Meta by its
// id, with our own token, so a forged call can't put anything in a CRM.
//
//   GET                  Meta's subscription check (META_WEBHOOK_VERIFY_TOKEN)
//   POST from Meta       leadgen events
//   POST { action: "subscribe" } with x-autopilot-secret: pg_cron, every 30
//                        minutes: subscribes each built client's Page to the
//                        app, and retries direct deliveries that failed
//   POST { action: "state" | "set_delivery", company_id } with a team login
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { graph } from "../_shared/meta-ads.ts";
import { metaIds } from "../_shared/rounds.ts";
import { setStep } from "../_shared/notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MAX_ATTEMPTS = 5;

type Admin = ReturnType<typeof createClient>;
type Row = Record<string, unknown>;
type LeadEvent = { leadgen_id?: string; page_id?: string; form_id?: string; ad_id?: string; created_time?: number };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  try {
    if (req.method === "GET") return verifySubscription(new URL(req.url));

    const secret = req.headers.get("x-autopilot-secret") || "";
    if (secret) {
      const { data: ok } = await admin.rpc("autopilot_secret_ok", { p: secret });
      const body = await req.json().catch(() => ({})) as Row;
      if (ok !== true || body.action !== "subscribe") return json({ error: "unauthorized" }, 401);
      return json(await subscribeAndRetry(admin));
    }

    if (req.headers.get("Authorization")) return await team(admin, req);

    // From Meta.
    const raw = await req.text();
    if (!(await signedByMeta(req, raw))) return json({ error: "bad signature" }, 401);
    const body = JSON.parse(raw || "{}") as { object?: string; entry?: { changes?: { field?: string; value?: LeadEvent }[] }[] };
    if (body.object !== "page") return json({ ok: true });
    const events = (body.entry || []).flatMap((e) => e.changes || []).filter((c) => c.field === "leadgen").map((c) => c.value || {});
    for (const ev of events) await receive(admin, ev);
    return json({ ok: true, received: events.length });
  } catch (err) {
    console.error("meta-leads error:", err);
    // Meta retries anything but a 200; a lead already recorded is skipped then.
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});

function verifySubscription(url: URL) {
  const expected = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");
  const ok = !!expected && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === expected;
  return ok ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : new Response("forbidden", { status: 403 });
}

/** Meta signs each call with the app secret. Without the secret set, reading leads back from Meta is the check. */
async function signedByMeta(req: Request, raw: string): Promise<boolean> {
  const appSecret = Deno.env.get("META_APP_SECRET");
  if (!appSecret) return true;
  const given = (req.headers.get("x-hub-signature-256") || "").replace(/^sha256=/, "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const want = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  if (given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

async function companyForPage(admin: Admin, pageId: string): Promise<Row | null> {
  const { data } = await admin.from("companies").select("id, name, dfy_profile, campaign_settings")
    .eq("dfy_profile->meta_access->>page_id", pageId).limit(1).maybeSingle();
  return (data as Row | null) ?? null;
}

const deliveryOf = (company: Row) =>
  ((company.campaign_settings || {}) as Row).lead_delivery === "direct" ? "direct" : "make";

async function receive(admin: Admin, ev: LeadEvent) {
  if (!ev.leadgen_id || !ev.page_id) return;
  const company = await companyForPage(admin, String(ev.page_id));
  if (!company) {
    console.warn("lead for a Page no client has:", ev.page_id);
    return;
  }
  const delivery = deliveryOf(company);
  const { data: fresh } = await admin.from("meta_leads").upsert({
    leadgen_id: String(ev.leadgen_id), company_id: company.id, page_id: String(ev.page_id),
    form_id: String(ev.form_id || ""), ad_id: ev.ad_id ? String(ev.ad_id) : null, delivery,
    meta_created_at: ev.created_time ? new Date(Number(ev.created_time) * 1000).toISOString() : null,
  }, { onConflict: "leadgen_id", ignoreDuplicates: true }).select("*");
  const row = (fresh ?? [])[0] as Row | undefined;
  if (row && delivery === "direct") await deliver(admin, row);
}

async function pageToken(pageId: string): Promise<string> {
  const out = await graph(`${pageId}?fields=access_token`);
  if (!out.access_token) throw new Error("No access to the client's Page");
  return String(out.access_token);
}

/** Read the lead back from Meta and put it into the client's CRM, once. */
async function deliver(admin: Admin, l: Row): Promise<boolean> {
  let leadId: string | null = null, error: string | null = null;
  let fields = (l.fields || {}) as Record<string, string>;
  try {
    if (!Object.keys(fields).length) {
      const out = await graph(`${l.leadgen_id}?fields=field_data,ad_id,form_id`, { token: await pageToken(String(l.page_id)) });
      fields = Object.fromEntries(((out.field_data || []) as { name: string; values: string[] }[]).map((f) => [f.name, (f.values || []).join(", ")]));
      await admin.from("meta_leads").update({ fields }).eq("leadgen_id", l.leadgen_id);
    }
    const { full_name, first_name, last_name, phone_number, email, post_code, zip_code, ...rest } = fields;
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/intake-lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({
        company_id: l.company_id,
        name: full_name || [first_name, last_name].filter(Boolean).join(" ") || "Facebook lead",
        phone: phone_number || undefined, email: email || undefined, postcode: post_code || zip_code || undefined,
        source: "Facebook Lead Ad",
        ...rest,
        meta_lead_id: l.leadgen_id, meta_form_id: l.form_id, ...(l.ad_id ? { meta_ad_id: l.ad_id } : {}),
      }),
    });
    const out = await res.json().catch(() => ({})) as Row;
    if (res.ok && out.lead_id) leadId = String(out.lead_id);
    else error = String(out.error || `HTTP ${res.status}`);
  } catch (e) {
    error = (e as Error).message;
  }
  await admin.from("meta_leads").update({ lead_id: leadId, error, attempts: Number(l.attempts || 0) + 1 }).eq("leadgen_id", l.leadgen_id);
  if (leadId) {
    const { data: done } = await admin.from("company_fulfilment").select("status").eq("company_id", l.company_id)
      .eq("step_key", "first_lead").maybeSingle();
    if (!["done", "skipped"].includes(String((done as Row | null)?.status))) {
      await setStep(admin, String(l.company_id), "first_lead", "done", "First lead from their Facebook instant form.", { id: null, name: "Automation" });
    }
  }
  return !!leadId;
}

/** Every built client's Page signed up to the app's leadgen webhook; failed direct deliveries tried again. */
async function subscribeAndRetry(admin: Admin) {
  const out = { subscribed: 0, waiting: [] as string[], retried: 0 };
  const { data: builds } = await admin.from("campaign_builds").select("id, company_id, meta").eq("status", "built");
  for (const b of (builds ?? []) as Row[]) {
    const meta = (b.meta || {}) as Row;
    if (meta.page_subscribed === true) continue;
    const { data: co } = await admin.from("companies").select("name, dfy_profile").eq("id", b.company_id).maybeSingle();
    const ids = co ? metaIds(co as Row) : null;
    if (!ids) continue;
    let result: true | string = true;
    try {
      await graph(`${ids.page}/subscribed_apps`, { token: await pageToken(ids.page), form: { subscribed_fields: "leadgen" } });
      out.subscribed++;
    } catch (e) {
      // Until pages_manage_metadata is approved this is expected; keep the reason.
      result = (e as Error).message;
      out.waiting.push(`${String((co as Row | null)?.name ?? b.company_id)}: ${result}`);
    }
    await admin.from("campaign_builds").update({ meta: { ...meta, page_subscribed: result } }).eq("id", b.id);
  }
  const { data: failed } = await admin.from("meta_leads").select("*").eq("delivery", "direct").is("lead_id", null)
    .lt("attempts", MAX_ATTEMPTS).order("created_at").limit(50);
  for (const l of (failed ?? []) as Row[]) if (await deliver(admin, l)) out.retried++;
  return { ok: true, ...out };
}

// ── The Team Panel: how this client's leads arrive ──────────────────────────────

async function team(admin: Admin, req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return json({ error: "Not authenticated" }, 401);
  const { data: me } = await admin.from("profiles").select("is_team, is_admin, team_role").eq("id", user.id).maybeSingle();
  const isTeam = me?.is_team === true, isAdmin = me?.is_admin === true;
  const isOps = isTeam && me?.team_role === "ops_manager";
  if (!isTeam && !isAdmin) return json({ error: "Forbidden: Internal Team access required" }, 403);
  const body = await req.json().catch(() => ({})) as Row;
  const companyId = String(body.company_id || "");
  if (!companyId) return json({ error: "company_id is required" }, 400);
  if (!(isAdmin || isOps)) {
    const { data: assigned } = await admin.from("team_assignments").select("company_id")
      .eq("team_user_id", user.id).eq("company_id", companyId).maybeSingle();
    if (!assigned) return json({ error: "Forbidden: client not assigned to you" }, 403);
  }
  const { data: company } = await admin.from("companies").select("id, campaign_settings").eq("id", companyId).maybeSingle();
  if (!company) return json({ error: "Client not found" }, 404);

  if (body.action === "set_delivery") {
    const delivery = body.delivery === "direct" ? "direct" : "make";
    await admin.from("companies").update({ campaign_settings: { ...((company.campaign_settings || {}) as Row), lead_delivery: delivery } }).eq("id", companyId);
    (company as Row).campaign_settings = { ...((company.campaign_settings || {}) as Row), lead_delivery: delivery };
  } else if (body.action !== "state") {
    return json({ error: `Unknown action: ${body.action}` }, 400);
  }

  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: recent } = await admin.from("meta_leads").select("delivery, lead_id, error, created_at")
    .eq("company_id", companyId).gte("created_at", since).order("created_at", { ascending: false }).limit(500);
  const rows = (recent ?? []) as Row[];
  return json({
    ok: true,
    delivery: deliveryOf(company as Row),
    last_30_days: {
      received: rows.length,
      delivered_direct: rows.filter((r) => r.lead_id).length,
      failed: rows.filter((r) => r.delivery === "direct" && !r.lead_id && r.error).length,
    },
    last_received_at: rows[0]?.created_at ?? null,
  });
}
