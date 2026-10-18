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
// A client who left the ID blank but whose business name matches exactly one
// shared ad account is NOT ticked automatically: the team gets one email
// asking them to confirm, because a wrong match would connect us to somebody
// else's account.
//
// POST {} with the x-watch-secret header (the scheduled job; the value is the
// vault secret meta_watch_secret), or { "dry_run": true } to see what it would
// do without writing or sending anything.
//
// Env: META_ACCESS_TOKEN (system user), META_BUSINESS_ID, META_GRAPH_VERSION,
//      META_AUTO_ASSIGN_USERS (comma-separated business user IDs),
//      RESEND_API_KEY, QL_MC_API_URL, QL_MC_API_SECRET.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import "../_shared/no-em-dash.ts";

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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json" } });
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

// Give a user (our system user, or a person in the business) access to an ad
// account or Page, unless they have it.
async function connect(
  kind: "ad_account" | "page", id: string, userId: string, token: string, dryRun: boolean,
): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  const node = kind === "ad_account" ? `act_${id}` : id;
  const { body: cur, error: readErr } = await graph(`${node}/assigned_users?business=${BUSINESS_ID}&fields=id`, token);
  if (!readErr && ((cur.data as Row[]) ?? []).some((u) => String(u.id) === userId)) return { ok: true, already: true };
  if (dryRun) return { ok: true, already: false };
  const tasks = kind === "ad_account" ? ["MANAGE", "ADVERTISE", "ANALYZE"] : ["ADVERTISE", "ANALYZE", "CREATE_CONTENT", "MODERATE"];
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
<p>Once access comes through we're notified straight away and the build starts. If you're stuck on any step, just reply to this email and we'll walk you through it.</p>
<p>QuoteLeads</p></div>`;
}

Deno.serve(async (req: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  // The scheduled job's secret lives only in the vault; the database checks it.
  const presented = req.headers.get("x-watch-secret") || "";
  const { data: authorised } = presented
    ? await admin.rpc("meta_watch_secret_ok", { p: presented })
    : { data: false };
  if (authorised !== true) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({})) as { dry_run?: boolean };
  const dryRun = body.dry_run === true;

  const token = Deno.env.get("META_ACCESS_TOKEN");
  if (!token) return json({ error: "META_ACCESS_TOKEN not configured" }, 500);

  // ── Who is still waiting on access ─────────────────────────────────────────
  const { data: companies } = await admin.from("companies")
    .select("id, name, email, dfy_profile").eq("plan", "managed");
  const ids = (companies ?? []).map((c) => c.id as string);
  if (!ids.length) return json({ ok: true, waiting: 0 });
  const { data: steps } = await admin.from("company_fulfilment")
    .select("company_id, step_key, status, completed_at").in("company_id", ids).in("step_key", [STEP, "paid_signed"]);
  const stepOf = (cid: string, key: string) => (steps ?? []).find((s) => s.company_id === cid && s.step_key === key);
  const waiting = (companies ?? []).filter((c) => {
    const s = stepOf(c.id as string, STEP)?.status;
    return s !== "done" && s !== "skipped";
  });
  if (!waiting.length) return json({ ok: true, waiting: 0 });

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
    graphList(`${BUSINESS_ID}/client_pages?fields=id,name,link`, token),
    graphList(`${BUSINESS_ID}/owned_pages?fields=id,name,link`, token),
  ]);
  const listErr = sharedAcc.error || sharedPages.error;
  if (listErr) return json({ ok: false, step: "list", error: listErr }, 502);
  const accounts = [...sharedAcc.data, ...ownedAcc.data];
  const pages = [...sharedPages.data, ...ownedPages.data];

  const { data: sentRows } = await admin.from("client_reminders").select("company_id, kind").in("company_id", ids);
  const sent = new Set((sentRows ?? []).map((r) => `${r.company_id}:${r.kind}`));
  const markSent = async (companyId: string, kind: string, detail: Row = {}) => {
    sent.add(`${companyId}:${kind}`);
    await admin.from("client_reminders").insert({ company_id: companyId, kind, detail });
  };

  const actions: Row[] = [];
  for (const c of waiting) {
    const cid = c.id as string;
    const profile = (c.dfy_profile ?? {}) as Row;
    const wantAcc = digits(profile.ad_account_id);
    const wantPage = pageKey(profile.facebook_page);

    // ── 1. Detect ───────────────────────────────────────────────────────────
    const acc = wantAcc ? accounts.find((a) => digits(a.account_id) === wantAcc) : undefined;
    if (acc) {
      const page = wantPage
        ? pages.find((p) => String(p.id) === wantPage || pageKey(p.link) === wantPage)
        : undefined;
      const accId = digits(acc.account_id);

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
        page ? `Page ${page.name} shared` : wantPage ? "Page not shared yet" : "",
        accConn.ok ? (accConn.already ? "System user already connected" : "System user connected automatically")
          : `Connect the system user by hand: ${accConn.error}`,
        pageConn && !pageConn.ok ? `Connect the Page by hand: ${pageConn.error}` : "",
        PEOPLE.length ? (peopleErrors.length ? `Assign people by hand: ${peopleErrors.join("; ")}` : "Team assigned") : "",
      ].filter(Boolean).join(". ");

      actions.push({ company: c.name, action: "access_granted", note, problems });
      if (!dryRun) {
        await setStep(admin, cid, "done", note);
        await admin.from("companies").update({
          dfy_profile: { ...profile, meta_access: { ad_account_id: accId, page_id: page?.id ?? null, detected_at: new Date().toISOString(), connected: accConn.ok } },
        }).eq("id", cid);
        const needsHand = !accConn.ok || (pageConn && !pageConn.ok) || peopleErrors.length > 0;
        await opsEmail(
          `${problems.length || needsHand ? "⚠️" : "✅"} Meta access received - ${c.name}`,
          `<p><strong>${c.name}</strong> shared their ad account <strong>${acc.name}</strong> (${accId}).</p><p>${note}.</p>` +
            (problems.length ? `<p style="color:#b42318"><strong>Needs attention:</strong> ${problems.join("; ")}.</p>` : "") +
            (needsHand ? `<p style="color:#b42318">Assign it by hand in Business Settings (Users → System users or People → Assign assets).</p>` : ""),
        );
      }
      continue;
    }

    // ── Name match, for a client who left the ID blank: ask, never tick ──────
    if (!wantAcc) {
      const n = normName(c.name);
      const hits = n ? accounts.filter((a) => normName(a.name) === n || normName((a.business as Row | undefined)?.name) === n) : [];
      if (hits.length === 1) {
        const hit = hits[0];
        const kind = `access_name_match:${digits(hit.account_id)}`;
        if (!sent.has(`${cid}:${kind}`)) {
          actions.push({ company: c.name, action: "name_match_suggested", account: hit.name });
          if (!dryRun) {
            await opsEmail(`Is this ${c.name}'s ad account?`,
              `<p>An ad account named <strong>${hit.name}</strong> (${digits(hit.account_id)}) is shared with QuoteLeads, and its name matches <strong>${c.name}</strong>, who didn't give their ad account ID.</p>` +
              `<p>If it's theirs, add <code>"ad_account_id": "${digits(hit.account_id)}"</code> to their onboarding profile in the Team Panel and the watch connects and ticks it on its next run. Otherwise tick "Meta/Google access granted" by hand once you've checked.</p>`);
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

    if (days >= 5 && !sent.has(`${cid}:access_day5`)) {
      actions.push({ company: c.name, action: "blocked_day5" });
      if (!dryRun) {
        await setStep(admin, cid, "blocked", "No Meta access 5 days after payment. Call them to get it done.");
        await opsEmail(`🔴 No Meta access after 5 days - ${c.name}`,
          `<p><strong>${c.name}</strong> paid 5 days ago and still hasn't shared their Facebook Page and ad account, after two reminder emails. Time for a call.</p>`);
        await markSent(cid, "access_day5");
      }
      continue;
    }
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
