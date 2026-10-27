// =============================================================================
// meta-access-watch - notice when a client gives us Meta access, chase if not
// =============================================================================
// Run every 15 minutes by pg_cron. For every managed client whose
// "Meta/Google access granted" step is still open:
//
//   1. DETECT   Is their ad account among those shared with the QuoteLeads
//               Business Manager? Matched on the ad account ID they gave on the
//               onboarding form, never on names alone.
//   2. CONNECT  Give our system user access to that ad account (and their Page
//               when we know it), the "Assign assets" step that used to be done
//               by hand. Only our own automation login is added to an account
//               the client already chose to share; nothing in their account
//               changes and nothing is spent. If Meta refuses, the step is still
//               ticked and the team is told to assign it by hand. The people in
//               META_AUTO_ASSIGN_USERS (Jack Buckley by default) are given the
//               same access, so the account shows up for them in Ads Manager.
//   3. TICK     Mark the step done with what was found: account status,
//               currency, whether a payment method is on file.
//
// When nothing has arrived, the client is chased: an email on day 2 and day 4
// after payment, and on day 5 the step is marked blocked, which raises an
// urgent Jarvis alert in Mission Control through the existing fulfilment
// mirror. Only clients who paid after CHASE_FROM are chased, so nobody from
// before this existed gets an email out of the blue.
//
// The onboarding form no longer asks for the ad account ID, so most accounts
// arrive unrecognised. Every account shared with us is recorded in
// meta_shared_accounts; one that no client is linked to gets one email to the
// team listing the clients waiting on access, each a one-click link that says
// "it's theirs" (meta-access.html, then the claim action here). The next run
// connects and ticks it. Never matched on names alone: a wrong match would
// connect us to somebody else's account. While an account sits unclaimed the
// client reminders are paused, since it's probably one of theirs.
//
// A client's reminder emails can also be stopped for good, from the Team
// Panel or the link in those team emails (client_reminders kind
// "access_reminders_off").
//
// POST {} with the x-watch-secret header (the scheduled job; the value is the
// vault secret meta_watch_secret), or { "dry_run": true } to see what it would
// do without writing or sending anything.
//
// POST { action: "claim" | "ignore" | "stop_reminders", c, acc, s } from
// meta-access.html: the links in the team emails, signed so only links this
// function made are accepted.
//
// Env: META_ACCESS_TOKEN (system user), META_BUSINESS_ID, META_GRAPH_VERSION,
//      META_AUTO_ASSIGN_USERS (comma-separated business user IDs),
//      RESEND_API_KEY, QL_MC_API_URL, QL_MC_API_SECRET.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import "../_shared/no-em-dash.ts";
import { anyNameMatches } from "../_shared/names.ts";

const BUSINESS_ID = Deno.env.get("META_BUSINESS_ID") || "1065750507426304";
const GRAPH = `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") || "v23.0"}`;
// Clients who paid before this are never chased: Phase 1 went live here.
const CHASE_FROM = Date.parse("2026-10-19T00:00:00Z");
const DAY = 86_400_000;
const STEP = "ad_access_granted";
// People in the QuoteLeads Business Manager given access alongside the system
// user. 1087487287498416 is Jack Buckley.
const PEOPLE = (Deno.env.get("META_AUTO_ASSIGN_USERS") || "1087487287498416")
  .split(",").map((v) => v.replace(/\D/g, "")).filter(Boolean);
const ACCOUNT_STATUS: Record<number, string> = {
  1: "active", 2: "disabled", 3: "unsettled", 7: "pending risk review",
  8: "pending settlement", 9: "in grace period", 100: "pending closure", 101: "closed",
};

type Admin = ReturnType<typeof createClient>;
type GraphError = { message: string; code?: number };
type Row = Record<string, unknown>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-watch-secret",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// ── The links in the team emails ─────────────────────────────────────────────
// Signed with the service role key, which never leaves the server, so a link
// can't be made up or edited to point at another client or account.
const LINK_ACTIONS = ["claim", "ignore", "stop_reminders"];

async function sign(action: string, c: string, acc: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${action}:${c}:${acc}`)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function link(action: string, c: string, acc: string, client = "", account = ""): Promise<string> {
  const q = new URLSearchParams({ a: action, c, acc, s: await sign(action, c, acc) });
  if (client) q.set("cn", client);
  if (account) q.set("an", account);
  return `https://quoteleadshq.com/meta-access.html?${q}`;
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));

async function handleLink(admin: Admin, b: Row): Promise<Response> {
  const action = String(b.action), c = String(b.c ?? ""), acc = digits(b.acc);
  if (!b.s || String(b.s) !== await sign(action, c, String(b.acc ?? ""))) {
    return json({ error: "This link isn't valid. Use the one in the email." }, 403);
  }
  const { data: co } = c ? await admin.from("companies").select("id, name, dfy_profile").eq("id", c).maybeSingle() : { data: null };
  if (c && !co) return json({ error: "That client no longer exists." }, 404);

  if (action === "ignore") {
    await admin.from("meta_shared_accounts").update({ ignored: true }).eq("account_id", acc);
    return json({ ok: true, message: "Ignored. Reminders to waiting clients carry on as normal." });
  }

  if (action === "stop_reminders") {
    const { data: off } = await admin.from("client_reminders").select("id")
      .eq("company_id", c).eq("kind", "access_reminders_off").maybeSingle();
    if (!off) await admin.from("client_reminders").insert({ company_id: c, kind: "access_reminders_off", detail: { by: "email link" } });
    return json({ ok: true, message: `${co!.name} won't get any more reminder emails about Meta access. Turn them back on in the Team Panel.` });
  }

  // claim: the account is this client's.
  const { data: row } = await admin.from("meta_shared_accounts").select("claimed_company_id").eq("account_id", acc).maybeSingle();
  if (row?.claimed_company_id && row.claimed_company_id !== c) {
    const { data: other } = await admin.from("companies").select("name").eq("id", row.claimed_company_id).maybeSingle();
    return json({ error: `That ad account is already linked to ${other?.name ?? "another client"}.` }, 409);
  }
  const profile = (co!.dfy_profile ?? {}) as Row;
  await admin.from("companies").update({ dfy_profile: { ...profile, ad_account_id: acc } }).eq("id", c);
  await admin.from("meta_shared_accounts").upsert({ account_id: acc, claimed_company_id: c, ignored: false }, { onConflict: "account_id" });
  await admin.from("fulfilment_log").insert({
    company_id: c, actor_id: null, actor_name: "Team (email link)", action: "meta_access.account_claimed",
    step_key: STEP, detail: { ad_account_id: acc },
  });
  return json({ ok: true, message: `Linked to ${co!.name}. Within 15 minutes we connect to it and tick their access step.` });
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
// "XYZ Solar & Electrical Pty Ltd" and "xyz solar and electrical" compare equal.
const normName = (v: unknown) => String(v ?? "").toLowerCase()
  .replace(/&/g, " and ").replace(/\b(pty|ltd|limited|co|the)\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ").trim();
// facebook.com/xyzsolar, https://www.facebook.com/xyzsolar/ and
// facebook.com/profile.php?id=123 all reduce to the part that identifies it.
function pageKey(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  const id = s.match(/[?&]id=(\d+)/);
  if (id) return id[1];
  const path = s.replace(/^https?:\/\//, "").replace(/^(www\.|m\.|web\.)?facebook\.com\//, "").split(/[/?#]/)[0];
  return path || "";
}

const graphUrl = (path: string, token: string) =>
  `${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;

async function fetchGraph(url: string, init?: RequestInit): Promise<{ body: Row; error?: GraphError }> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({})) as Row;
  if (!res.ok || body.error) return { body, error: (body.error as GraphError) ?? { message: `HTTP ${res.status}` } };
  return { body };
}
const graph = (path: string, token: string, init?: RequestInit) => fetchGraph(graphUrl(path, token), init);

// Every page of a Graph edge. Meta's paging.next links carry the token already.
async function graphList(path: string, token: string): Promise<{ data: Row[]; error?: GraphError }> {
  const out: Row[] = [];
  let url: string | null = graphUrl(`${path}${path.includes("?") ? "&" : "?"}limit=100`, token);
  for (let i = 0; url && i < 20; i++) {
    const { body, error } = await fetchGraph(url);
    if (error) return { data: out, error };
    out.push(...((body.data as Row[]) ?? []));
    url = ((body.paging as Row | undefined)?.next as string | undefined) ?? null;
  }
  return { data: out };
}

const TASKS = {
  ad_account: ["MANAGE", "ADVERTISE", "ANALYZE"],
  page: ["ADVERTISE", "ANALYZE", "CREATE_CONTENT", "MODERATE"],
};

// Give a user (our system user, or a person in the business) access to an ad
// account or Page, unless they have it.
async function connect(
  kind: keyof typeof TASKS, id: string, userId: string, token: string, dryRun: boolean,
): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  const node = kind === "ad_account" ? `act_${id}` : id;
  const { body: cur, error: readErr } = await graph(`${node}/assigned_users?business=${BUSINESS_ID}&fields=id`, token);
  if (!readErr && ((cur.data as Row[]) ?? []).some((u) => String(u.id) === userId)) return { ok: true, already: true };
  if (dryRun) return { ok: true, already: false };
  const tasks = TASKS[kind];
  const form = new URLSearchParams({ user: userId, tasks: JSON.stringify(tasks), business: BUSINESS_ID });
  const { error } = await graph(`${node}/assigned_users`, token, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Same writer as growth-onboarding's setStep: the step, a log line, the mirror.
async function setStep(admin: Admin, companyId: string, status: string, notes: string) {
  const settled = status === "done" || status === "skipped";
  const { data: prev } = await admin.from("company_fulfilment").select("status")
    .eq("company_id", companyId).eq("step_key", STEP).maybeSingle();
  const { error } = await admin.from("company_fulfilment").upsert({
    company_id: companyId, step_key: STEP, status, notes: notes.slice(0, 2000),
    completed_by: null, completed_by_name: settled ? "Automation" : null,
  }, { onConflict: "company_id,step_key" });
  if (error) { console.warn("setStep failed:", error.message); return; }
  await admin.from("fulfilment_log").insert({
    company_id: companyId, actor_id: null, actor_name: "Automation", action: "fulfilment.step_set",
    step_key: STEP, from_status: prev?.status ?? "pending", to_status: status, detail: { notes: notes.slice(0, 500) },
  });
  const url = Deno.env.get("QL_MC_API_URL"), secret = Deno.env.get("QL_MC_API_SECRET");
  if (!url || !secret) return;
  try {
    const { data: sum } = await admin.from("company_fulfilment_summary")
      .select("stage, stage_at, active_status, steps_done, steps_settled, steps_total, blocked_count, next_step_key, next_step_due")
      .eq("company_id", companyId).maybeSingle();
    if (sum) {
      await fetch(`${url}/sync-from-hq`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-api-secret": secret },
        body: JSON.stringify({ action: "upsert_fulfilment", hq_company_id: companyId, summary: sum }),
      });
    }
  } catch (e) {
    console.warn("ql-mc mirror failed:", (e as Error).message);
  }
}

async function sendEmail(to: string, subject: string, html: string, from = "QuoteLeads <onboarding@quoteleads.com.au>") {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, reply_to: "contact@quoteleads.com.au" }),
  }).catch(() => null);
  if (!res?.ok) console.error("email failed:", subject, res?.status, await res?.text().catch(() => ""));
  return !!res?.ok;
}
const opsEmail = (subject: string, body: string) =>
  sendEmail("contact@quoteleads.com.au", subject,
    `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#333;line-height:1.7">${body}</div>`,
    "QuoteLeads System <system@quoteleads.com.au>");

function reminderHtml(firstName: string, second: boolean) {
  const link = "https://quoteleadshq.com/dashboard?page=onboarding";
  const lead = second
    ? "We still can't start building your campaigns, because we don't yet have access to your Facebook Page and ad account."
    : "Quick reminder: to start building your campaigns we need access to your Facebook Page and ad account.";
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a20;line-height:1.65;max-width:560px">
<p>Hi ${firstName},</p>
<p>${lead} It takes about five minutes, and you keep full ownership of everything.</p>
<p><a href="${link}" style="display:inline-block;background:#4797FF;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500">Open the step-by-step guide</a></p>
<p>Once access comes through, we'll get started on your build. If you're stuck on any step, just reply to this email and we'll walk you through it.</p>
<p>QuoteLeads</p></div>`;
}

Deno.serve(async (req: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({})) as Row;
  if (LINK_ACTIONS.includes(String(body.action))) return handleLink(admin, body);

  // The scheduled job's secret lives only in the vault; the database checks it.
  const presented = req.headers.get("x-watch-secret") || "";
  const { data: authorised } = presented
    ? await admin.rpc("meta_watch_secret_ok", { p: presented })
    : { data: false };
  if (authorised !== true) return json({ error: "unauthorized" }, 401);
  const dryRun = body.dry_run === true;

  const token = Deno.env.get("META_ACCESS_TOKEN");
  if (!token) return json({ error: "META_ACCESS_TOKEN not configured" }, 500);

  // ── Who is still waiting on access ─────────────────────────────────────────
  const { data: companies } = await admin.from("companies")
    .select("id, name, email, dfy_profile").eq("plan", "managed");
  const ids = (companies ?? []).map((c) => c.id as string);
  const { data: steps } = ids.length
    ? await admin.from("company_fulfilment")
      .select("company_id, step_key, status, completed_at").in("company_id", ids).in("step_key", [STEP, "paid_signed"])
    : { data: [] };
  const stepOf = (cid: string, key: string) => (steps ?? []).find((s) => s.company_id === cid && s.step_key === key);
  const waiting = (companies ?? []).filter((c) => {
    const s = stepOf(c.id as string, STEP)?.status;
    return s !== "done" && s !== "skipped";
  });

  // ── What Meta shows us ────────────────────────────────────────────────────
  const me = await graph("me?fields=id,name", token);
  if (me.error) {
    await opsEmail("Meta access watch: the Meta token failed",
      `<p>The access watch could not use the Meta token: ${me.error.message}</p><p>Nothing was ticked or sent this run.</p>`);
    return json({ ok: false, step: "token", error: me.error }, 502);
  }
  const systemUserId = String(me.body.id);

  const accFields = "account_id,name,account_status,disable_reason,currency,business{id,name}";
  const [sharedAcc, ownedAcc, sharedPages, ownedPages] = await Promise.all([
    graphList(`${BUSINESS_ID}/client_ad_accounts?fields=${accFields}`, token),
    graphList(`${BUSINESS_ID}/owned_ad_accounts?fields=${accFields}`, token),
    // The owning business, so a Page can be matched to the ad account it came
    // with; without it if Meta won't give it.
    graphList(`${BUSINESS_ID}/client_pages?fields=id,name,link,business{id,name}`, token)
      .then((r) => r.error ? graphList(`${BUSINESS_ID}/client_pages?fields=id,name,link`, token) : r),
    graphList(`${BUSINESS_ID}/owned_pages?fields=id,name,link`, token),
  ]);
  const listErr = sharedAcc.error || sharedPages.error;
  if (listErr) return json({ ok: false, step: "list", error: listErr }, 502);
  const accounts = [...sharedAcc.data, ...ownedAcc.data];
  const pages = [...sharedPages.data, ...ownedPages.data];

  // ── Shared accounts nobody has claimed ──────────────────────────────────────
  // The first run records what was already shared as the baseline, so only
  // accounts shared from now on are ever emailed about.
  const { count: known } = await admin.from("meta_shared_accounts").select("account_id", { count: "exact", head: true });
  if (!dryRun && sharedAcc.data.length) {
    await admin.from("meta_shared_accounts").upsert(sharedAcc.data.map((a) => ({
      account_id: digits(a.account_id), name: a.name ?? null,
      business_name: (a.business as Row | undefined)?.name ?? null, baseline: !known,
    })), { onConflict: "account_id", ignoreDuplicates: true });
  }
  // Linked already: an ID on any client's profile, given or claimed.
  const { data: allCos } = await admin.from("companies").select("id, dfy_profile");
  const linked = new Map<string, string>();
  for (const co of allCos ?? []) {
    const p = (co.dfy_profile ?? {}) as Row;
    for (const id of [digits(p.ad_account_id), digits((p.meta_access as Row | undefined)?.ad_account_id)]) {
      if (id) linked.set(id, co.id as string);
    }
  }
  const { data: open } = await admin.from("meta_shared_accounts").select("*")
    .eq("baseline", false).eq("ignored", false).is("claimed_company_id", null);
  const unclaimed: Row[] = [];
  for (const r of open ?? []) {
    const owner = linked.get(String(r.account_id));
    if (owner) { if (!dryRun) await admin.from("meta_shared_accounts").update({ claimed_company_id: owner }).eq("account_id", r.account_id); }
    else unclaimed.push(r);
  }
  const unclaimedIds = new Set(unclaimed.map((r) => String(r.account_id)));

  const actions: Row[] = [];
  for (const r of unclaimed.filter((x) => !x.notified_at)) {
    const acc = String(r.account_id);
    actions.push({ action: "unclaimed_account", account: r.name, account_id: acc });
    if (dryRun) continue;
    // A waiting client whose name matches goes first; it's only a hint.
    const n = normName(r.name), bn = normName(r.business_name);
    const sorted = [...waiting].sort((a, b) =>
      Number([n, bn].includes(normName(b.name))) - Number([n, bn].includes(normName(a.name))));
    const items = await Promise.all(sorted.map(async (c) => {
      const match = [n, bn].includes(normName(c.name)) ? " <em>(name matches)</em>" : "";
      return `<li style="margin-bottom:6px"><a href="${await link("claim", c.id as string, acc, c.name as string, String(r.name ?? ""))}"><strong>${esc(c.name)}</strong></a>${match}` +
        ` &nbsp;·&nbsp; <a href="${await link("stop_reminders", c.id as string, "", c.name as string)}" style="color:#667284;font-size:12px">stop their reminder emails</a></li>`;
    }));
    await opsEmail(`New ad account shared: ${String(r.name ?? acc)}. Whose is it?`,
      `<p>An ad account was just shared with QuoteLeads and isn't linked to any client: <strong>${esc(r.name)}</strong> (${acc})` +
      `${r.business_name ? `, from the business <strong>${esc(r.business_name)}</strong>` : ""}.</p>` +
      (items.length
        ? `<p>Click the client it belongs to. Within 15 minutes we connect to it and tick their access step.</p><ul>${items.join("")}</ul>`
        : "<p>No client is waiting on Meta access right now.</p>") +
      `<p><a href="${await link("ignore", "", acc, "", String(r.name ?? ""))}">It isn't a client's, ignore it</a></p>` +
      `<p style="color:#667284">Until it's linked or ignored, the "please give us access" reminder emails to waiting clients are paused, in case it's theirs.</p>`);
    await admin.from("meta_shared_accounts").update({ notified_at: new Date().toISOString() }).eq("account_id", acc);
  }

  if (!waiting.length) return json({ ok: true, dry_run: dryRun, waiting: 0, unclaimed: unclaimed.length, actions });

  const { data: sentRows } = await admin.from("client_reminders").select("company_id, kind").in("company_id", ids);
  const sent = new Set((sentRows ?? []).map((r) => `${r.company_id}:${r.kind}`));
  const markSent = async (companyId: string, kind: string, detail: Row = {}) => {
    sent.add(`${companyId}:${kind}`);
    await admin.from("client_reminders").insert({ company_id: companyId, kind, detail });
  };

  for (const c of waiting) {
    const cid = c.id as string;
    const profile = (c.dfy_profile ?? {}) as Row;
    const wantAcc = digits(profile.ad_account_id);
    const wantPage = pageKey(profile.facebook_page);

    // ── 1. Detect ───────────────────────────────────────────────────────────
    const acc = wantAcc ? accounts.find((a) => digits(a.account_id) === wantAcc) : undefined;
    if (acc) {
      const accId = digits(acc.account_id);
      // Their Page: the one they named, else the one plainly theirs among those
      // shared with us and not already another client's: the only one from the
      // same business as the ad account, else the only one whose name matches
      // theirs. Anything less certain is left for the team to pick.
      const takenPages = new Set((allCos ?? []).filter((co) => co.id !== cid)
        .map((co) => String((((co.dfy_profile ?? {}) as Row).meta_access as Row | undefined)?.page_id ?? "")).filter(Boolean));
      const free = pages.filter((p) => !takenPages.has(String(p.id)));
      const accBiz = (acc.business as Row | undefined) ?? {};
      const sameBiz = accBiz.id ? free.filter((p) => String(((p.business as Row | undefined) ?? {}).id || "") === String(accBiz.id)) : [];
      const byName = free.filter((p) => anyNameMatches([p.name], [c.name, acc.name, accBiz.name]));
      const both = sameBiz.filter((p) => byName.includes(p));
      const page = wantPage
        ? pages.find((p) => String(p.id) === wantPage || pageKey(p.link) === wantPage)
        : sameBiz.length === 1 ? sameBiz[0] : byName.length === 1 ? byName[0] : both.length === 1 ? both[0] : undefined;
      const pageChoices = page ? [] : (sameBiz.length ? sameBiz : byName).slice(0, 8);

      // Health of the account, so the team hears about a problem now rather
      // than when the campaign will not publish.
      const status = ACCOUNT_STATUS[acc.account_status as number] ?? String(acc.account_status);
      const fund = await graph(`act_${accId}?fields=funding_source_details`, token);
      const hasPayment = fund.error ? null : !!fund.body.funding_source_details;
      const problems = [
        status !== "active" ? `account is ${status}` : "",
        acc.currency && acc.currency !== "AUD" ? `currency is ${acc.currency}, not AUD` : "",
        hasPayment === false ? "no payment method on the ad account" : "",
      ].filter(Boolean);

      // ── 2. Connect ────────────────────────────────────────────────────────
      const accConn = await connect("ad_account", accId, systemUserId, token, dryRun);
      const pageConn = page ? await connect("page", String(page.id), systemUserId, token, dryRun) : null;
      // The same for the people who work on the account, so it shows up in
      // their Ads Manager. A refusal here only asks the team to do it by hand.
      const peopleErrors: string[] = [];
      for (const person of PEOPLE) {
        const a = await connect("ad_account", accId, person, token, dryRun);
        if (!a.ok) peopleErrors.push(`ad account for user ${person}: ${a.error}`);
        if (page) {
          const p = await connect("page", String(page.id), person, token, dryRun);
          if (!p.ok) peopleErrors.push(`Page for user ${person}: ${p.error}`);
        }
      }

      // ── 3. Tick ───────────────────────────────────────────────────────────
      const note = [
        `Ad account ${acc.name} (${accId}) shared: ${status}, ${acc.currency}` +
          (hasPayment === null ? "" : hasPayment ? ", payment method on file" : ", no payment method"),
        page ? `Page ${page.name} shared` : wantPage ? "Page not shared yet"
          : `Page not picked${pageChoices.length ? ` (could be ${pageChoices.map((p) => `${p.name} ${p.id}`).join(", ")})` : ""}: set it in the Team Panel, Campaign, Meta connection`,
        accConn.ok ? (accConn.already ? "System user already connected" : "System user connected automatically")
          : `Connect the system user by hand: ${accConn.error}`,
        pageConn && !pageConn.ok ? `Connect the Page by hand: ${pageConn.error}` : "",
        PEOPLE.length ? (peopleErrors.length ? `Assign people by hand: ${peopleErrors.join("; ")}` : "Team assigned") : "",
      ].filter(Boolean).join(". ");

      actions.push({ company: c.name, action: "access_granted", note, problems });
      if (!dryRun) {
        await setStep(admin, cid, "done", note);
        await admin.from("meta_shared_accounts").update({ claimed_company_id: cid }).eq("account_id", accId);
        await admin.from("companies").update({
          dfy_profile: { ...profile, meta_access: { ad_account_id: accId, page_id: page?.id ?? null, detected_at: new Date().toISOString(), connected: accConn.ok } },
        }).eq("id", cid);
        const needsHand = !accConn.ok || (pageConn && !pageConn.ok) || peopleErrors.length > 0;
        await opsEmail(
          `${problems.length || needsHand ? "⚠️" : "✅"} Meta access received - ${c.name}`,
          `<p><strong>${c.name}</strong> shared their ad account <strong>${acc.name}</strong> (${accId}).</p><p>${note}.</p>` +
            (problems.length ? `<p style="color:#b42318"><strong>Needs attention:</strong> ${problems.join("; ")}.</p>` : "") +
            (needsHand ? `<p style="color:#b42318">Assign it by hand in Business Settings (Users → System users or People → Assign assets).</p>` : "") +
            (!page ? `<p style="color:#b42318"><strong>Which Page is theirs?</strong> We couldn't tell for sure${pageChoices.length
              ? `. It's probably one of these: <ul>${pageChoices.map((p) => `<li>${esc(p.name)} (${p.id})</li>`).join("")}</ul>`
              : ", and no Page shared with us looks like theirs yet. "}Set it on their page in the Team Panel (Campaign, Meta connection) and the ads can be built.</p>` : ""),
        );
      }
      continue;
    }

    // ── Name match, for a client who left the ID blank: ask, never tick ──────
    // Not for an account just shared: the unclaimed email already asked.
    if (!wantAcc) {
      const n = normName(c.name);
      const hits = n ? accounts.filter((a) => normName(a.name) === n || normName((a.business as Row | undefined)?.name) === n) : [];
      if (hits.length === 1 && !unclaimedIds.has(digits(hits[0].account_id))) {
        const hit = hits[0];
        const kind = `access_name_match:${digits(hit.account_id)}`;
        if (!sent.has(`${cid}:${kind}`)) {
          actions.push({ company: c.name, action: "name_match_suggested", account: hit.name });
          if (!dryRun) {
            await opsEmail(`Is this ${c.name}'s ad account?`,
              `<p>An ad account named <strong>${hit.name}</strong> (${digits(hit.account_id)}) is shared with QuoteLeads, and its name matches <strong>${c.name}</strong>, who didn't give their ad account ID.</p>` +
              `<p><a href="${await link("claim", cid, digits(hit.account_id), c.name as string, String(hit.name ?? ""))}">Yes, it's theirs</a>: within 15 minutes we connect to it and tick their access step. Otherwise tick "Meta/Google access granted" by hand once you've checked.</p>`);
            await markSent(cid, kind, { account_id: digits(hit.account_id) });
          }
        }
      }
    }

    // ── Chase ──────────────────────────────────────────────────────────────
    const paid = stepOf(cid, "paid_signed");
    const paidAt = paid?.status === "done" && paid.completed_at ? Date.parse(paid.completed_at as string) : NaN;
    if (!Number.isFinite(paidAt) || paidAt < CHASE_FROM) continue;
    const days = (Date.now() - paidAt) / DAY;
    // An account nobody has claimed is probably theirs: wait for the team.
    if (unclaimed.length) {
      actions.push({ company: c.name, action: "chase_paused", reason: "unclaimed account shared" });
      continue;
    }
    const remindersOff = sent.has(`${cid}:access_reminders_off`);

    if (days >= 5 && !sent.has(`${cid}:access_day5`)) {
      actions.push({ company: c.name, action: "blocked_day5" });
      if (!dryRun) {
        await setStep(admin, cid, "blocked", "No Meta access 5 days after payment. Call them to get it done.");
        await opsEmail(`🔴 No Meta access after 5 days - ${c.name}`,
          `<p><strong>${c.name}</strong> paid 5 days ago and still hasn't shared their Facebook Page and ad account${remindersOff ? "" : ", after two reminder emails"}. Time for a call.</p>`);
        await markSent(cid, "access_day5");
      }
      continue;
    }
    if (remindersOff) continue;
    for (const [kind, after, second] of [["access_day4", 4, true], ["access_day2", 2, false]] as const) {
      if (days < after || sent.has(`${cid}:${kind}`)) continue;
      // Day 4 is checked first, so a run that finds day 2 never went (the watch
      // was down) sends only the firmer one, not both in the same minute.
      const to = await recipient(admin, cid, c.email as string | null);
      actions.push({ company: c.name, action: kind, to });
      if (!dryRun && to) {
        const first = await firstName(admin, cid);
        const ok = await sendEmail(to,
          second ? "Still waiting on your Facebook access" : "One step left before we can build your campaigns",
          reminderHtml(first, second));
        if (ok) {
          await markSent(cid, kind, { to });
          if (second && !sent.has(`${cid}:access_day2`)) await markSent(cid, "access_day2", { skipped: true });
        }
      }
      break;
    }
  }

  return json({ ok: true, dry_run: dryRun, waiting: waiting.length, accounts_visible: accounts.length, actions });
});

// The owner's login email, which is who actually reads it; else the company's.
async function recipient(admin: Admin, companyId: string, fallback: string | null): Promise<string | null> {
  const { data: owner } = await admin.from("profiles").select("id").eq("company_id", companyId)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (owner?.id) {
    const { data } = await admin.auth.admin.getUserById(owner.id as string);
    if (data?.user?.email) return data.user.email;
  }
  return fallback || null;
}

async function firstName(admin: Admin, companyId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("full_name").eq("company_id", companyId)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  return String(data?.full_name || "").trim().split(/\s+/)[0] || "there";
}
