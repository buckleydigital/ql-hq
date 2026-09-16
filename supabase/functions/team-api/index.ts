// =============================================================================
// team-api - Internal Team API (the Team Panel at /team-panel)
// =============================================================================
// The product calls these people the Internal Team. The function, the is_team
// flag and the team_assignments table keep their old names on purpose: they are
// load-bearing in a deployed URL, live RLS and shipped HTML, and renaming them
// buys nothing a comment cannot. New action names use the new vocabulary and
// the old ones stay accepted (see ACTION_ALIASES) so a cached page keeps
// working through the rollout.
//
// THREE CALLERS, one function, all verified server-side via the service role
// (never trusting the client):
//
//   Internal Team member  (profiles.is_team, team_role = 'member')
//     Sees and acts on the clients assigned to them, and nothing else.
//
//   Ops manager           (profiles.is_team, team_role = 'ops_manager')
//     Sees and acts on EVERY client, can move another member's steps, and can
//     reassign clients. Cannot mint accounts or grant access - set_team_member
//     stays admin-only, so an ops manager directs the work without being able
//     to widen who does it.
//
//   Admin                 (profiles.is_admin)
//     Everything, as before.
//
// Scope is resolved in exactly one place (`resolveScope`): null means every
// client, a Set means those clients. Before this there were three copies of
// that logic with three separate "null means unrestricted" conventions, which
// is how a new tier ends up correct in one block and wrong in another.
//
// EVERY MUTATION IS LOGGED to fulfilment_log via `logAction`, with the actor.
// That table is hard-locked away from clients (RLS forced, no policy, grants
// revoked) - see 20260915000001_fulfilment_tracking.sql. Logging is
// best-effort on purpose: a failed write to the audit trail must never undo
// the work it was describing.
//
// No existing RLS policy is involved - this mirrors how impersonate-user backs
// the /admin panel, so client + super-admin behaviour is unchanged.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveCallerUser(
  authHeader: string,
  userClient: ReturnType<typeof createClient>,
) {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const { data: { user }, error } = await userClient.auth.getUser(token);
    if (user) return user;
    if (error) console.warn("auth.getUser() failed:", error.message);
  } catch (e) {
    console.warn("auth.getUser() threw:", (e as Error).message);
  }
  return null;
}

// Build a map of user_id → email from auth.users (paginated).
async function emailMap(adminClient: ReturnType<typeof createClient>, ids: string[]) {
  const map: Record<string, string> = {};
  if (!ids.length) return map;
  const want = new Set(ids);
  let page = 1;
  while (want.size > 0) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      if (want.has(u.id)) { map[u.id] = u.email ?? ""; want.delete(u.id); }
    }
    if (data.users.length < 1000) break;
    page++;
  }
  return map;
}

// Whitelist + coerce an invoice payload coming from the client. `isPatch`
// omits absent keys (so an update only touches what was sent); a full create
// still only writes recognised columns.
function sanitizeInvoice(src: Record<string, unknown>, isPatch = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const textFields = [
    "company_id", "invoice_number", "client_name", "client_email", "offer_type",
    "vertical", "gst_type", "payment_details", "notes", "status", "invoice_date",
    "due_date", "delivery_period_start", "delivery_period_end",
  ];
  const numFields = ["subtotal", "gst_amount", "total"];
  for (const k of textFields) {
    if (k in src) out[k] = src[k] === "" ? null : src[k];
  }
  for (const k of numFields) {
    if (k in src) { const n = Number(src[k]); out[k] = Number.isFinite(n) ? n : 0; }
  }
  if ("line_items" in src) out.line_items = Array.isArray(src.line_items) ? src.line_items : [];
  if (!isPatch) {
    if (out.status == null) out.status = "draft";
    if (out.line_items == null) out.line_items = [];
  }
  // status guard
  if ("status" in out && out.status != null && !["draft", "sent", "paid", "unpaid"].includes(out.status as string)) {
    out.status = "draft";
  }
  return out;
}

// ── Email plumbing ──────────────────────────────────────────────────────────
// A team member writes a plain script; this renders it as the plain email a person
// would have typed rather than a marketing template.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

function escHtml(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function textToHtml(text: string): string {
  const paras = String(text).split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 16px">${escHtml(p).replace(/\n/g, "<br>")}</p>`
  ).join("");
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:600px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#1a1a20">
${paras}
</div></body></html>`;
}

async function sendEmail(opts: {
  to: string; subject: string; text: string; fromName?: string; replyTo?: string | null;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, error: "Email is not configured" };
  const fromName = opts.fromName || "QuoteLeads";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName} <system@quoteleads.com.au>`,
      to: opts.to,
      subject: opts.subject,
      html: textToHtml(opts.text),
      text: opts.text,
      ...(opts.replyTo && EMAIL_RE.test(opts.replyTo) ? { reply_to: opts.replyTo } : {}),
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("resend error:", res.status, JSON.stringify(payload));
    return { ok: false, error: "The email provider rejected the message" };
  }
  return { ok: true, id: (payload as { id?: string }).id };
}

// Jeff Jones → Jeff. A placeholder with no value takes its surrounding
// punctuation with it, and a line that was nothing but placeholders is dropped
// rather than left as a blank gap in the middle of the email.
function mergeTemplate(text: string, vals: Record<string, string>): string {
  const PH = /\{(first_name|company_name|va_name|va_email|contact_name)\}/g;
  return String(text || "")
    .split("\n")
    .map((line) => {
      const hadPlaceholder = PH.test(line);
      PH.lastIndex = 0;
      const merged = line
        .replace(PH, (_m, k) => vals[k] || "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+([,.;:!?])/g, "$1")
        .replace(/\s+-\s*$/, "");
      return hadPlaceholder && !merged.trim() ? null : merged;
    })
    .filter((line): line is string => line !== null)
    .join("\n")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const caller = await resolveCallerUser(authHeader, userClient);
    if (!caller) return json({ error: "Not authenticated" }, 401);

    // Resolve caller flags via service role (never trust a client-supplied value).
    const { data: me, error: meErr } = await adminClient
      .from("profiles")
      .select("is_team, is_admin, full_name, team_role")
      .eq("id", caller.id)
      .maybeSingle();
    if (meErr) {
      console.error("caller profile lookup failed:", meErr.message);
      return json({ error: "Internal error" }, 500);
    }
    const isTeam = me?.is_team === true;          // on the Internal Team at all
    const isAdmin = me?.is_admin === true;
    // team_role only means anything alongside is_team. Reading it off a client's
    // profile must not promote them, hence the isTeam guard rather than a bare
    // comparison.
    const isOps = isTeam && me?.team_role === "ops_manager";
    // Who sees every client. Was "isAdmin || isOps"; it is now a capability, so
    // a media buyer can be given the whole book without being made an ops
    // manager, and an ops manager can be narrowed without renaming their job.
    // Resolved after perms below, so declared with let and assigned there.
    let unrestricted = isAdmin;
    const actorName = (me?.full_name as string) || (isAdmin ? "Admin" : isOps ? "Ops Manager" : "Internal Team");

    // ── Capabilities ────────────────────────────────────────────────────────
    // What this caller may do, read from team_role_permissions rather than
    // inferred from the role's name. Before this, "ops_manager" was hardcoded to
    // mean unrestricted and fulfilment was open to the whole team, so changing
    // either meant redeploying this function - the wrong place for a permissions
    // decision.
    //
    // An admin is not a team role and is never limited by the table. A team
    // member whose role has no row gets nothing beyond their own clients, which
    // is the safe direction: a missing row must not read as a wildcard.
    const CAPS = [
      "all_clients", "fulfilment_view", "fulfilment_edit", "automations_run",
      "intro_email_send", "preview_email_send", "invoices_manage",
      "signups_review", "assignments_manage",
    ] as const;
    type Cap = typeof CAPS[number];

    // Resolving a role's capabilities is its own step because the admin preview
    // needs to answer it for somebody other than the caller: previewing a CSM
    // has to show the CSM's buttons, not the admin's, or the preview lies about
    // what that person can do.
    const permsForRole = async (role: string | null | undefined): Promise<Record<Cap, boolean>> => {
      const { data: row } = await adminClient
        .from("team_role_permissions").select("*")
        .eq("role", role || "csm").maybeSingle();
      const p = Object.fromEntries(CAPS.map((c) => [c, row?.[c] === true])) as Record<Cap, boolean>;
      // edit without view is not a coherent state; do not let a bad row grant it.
      if (!p.fulfilment_view) p.fulfilment_edit = false;
      return p;
    };

    let perms: Record<Cap, boolean>;
    if (isAdmin) {
      perms = Object.fromEntries(CAPS.map((c) => [c, true])) as Record<Cap, boolean>;
    } else {
      perms = await permsForRole(me?.team_role as string);
    }
    const can = (c: Cap) => perms[c] === true;
    unrestricted = isAdmin || (isTeam && can("all_clients"));

    const rawBody = await req.json().catch(() => ({}));
    const body = rawBody as Record<string, unknown>;
    // The panel was renamed from VA to Internal Team. The new names are
    // canonical; the old ones are accepted so a browser holding the previous
    // page mid-rollout is not an outage. Old → new, not the other way round.
    const ACTION_ALIASES: Record<string, string> = {
      list_vas:              "list_team",
      set_va:                "set_team_member",
      set_va_reply_to:       "set_team_reply_to",
      admin_list_va_clients: "list_team_clients",
      mark_intro_done:       "mark_intro_email_sent",
    };
    const requested = (rawBody as { action?: string }).action;
    const action = ACTION_ALIASES[requested || ""] || requested;

    // ── Mirror the derived summary to ql-mc ─────────────────────────────────
    // ql-hq owns the step state and the audit trail; ql-mc owns the roll-up and
    // draws the kanban from it. It gets the DERIVED summary only - never the
    // log - through the same sync-from-hq bridge stripe-webhook and
    // dispute-lead already use.
    //
    // Best effort, and deliberately so: the step is already committed here, and
    // ql-mc being briefly stale is a cosmetic problem where refusing the step
    // because a second service is down is a real one. recalc_company_fulfilment
    // keeps the summary correct locally either way, so a missed push is
    // recoverable by the next one.
    const pushFulfilmentToMc = async (companyId: string) => {
      const QL_MC_API_URL    = Deno.env.get("QL_MC_API_URL");
      const QL_MC_API_SECRET = Deno.env.get("QL_MC_API_SECRET");
      if (!QL_MC_API_URL || !QL_MC_API_SECRET) {
        console.warn("QL_MC_API_URL / QL_MC_API_SECRET not configured - fulfilment not mirrored to ql-mc");
        return;
      }
      try {
        const { data: sum } = await adminClient
          .from("company_fulfilment_summary")
          .select("stage, stage_at, active_status, steps_done, steps_settled, steps_total, blocked_count, next_step_key, next_step_due")
          .eq("company_id", companyId)
          .maybeSingle();
        if (!sum) return;
        const res = await fetch(`${QL_MC_API_URL}/sync-from-hq`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-secret": QL_MC_API_SECRET },
          body: JSON.stringify({ action: "upsert_fulfilment", hq_company_id: companyId, summary: sum }),
        });
        if (!res.ok) {
          console.warn("ql-mc fulfilment mirror rejected:", res.status, await res.text().catch(() => ""));
        }
      } catch (e) {
        console.warn("ql-mc fulfilment mirror failed:", (e as Error).message);
      }
    };

    // ── Set one step, log the transition, mirror the result ─────────────────
    // The single writer for company_fulfilment. Everything that completes a
    // step goes through here rather than updating the table directly, so no
    // path can change a step without leaving a log line: the log is not a
    // courtesy the caller remembers, it is part of the write.
    const setStep = async (
      companyId: string,
      stepKey: string,
      status: string,
      notes: string | null,
    ): Promise<{ ok: true; step: Record<string, unknown> } | { ok: false; error: string; code: number }> => {
      const VALID = ["pending", "in_progress", "blocked", "done", "skipped"];
      if (!VALID.includes(status)) return { ok: false, error: `status must be one of ${VALID.join(", ")}`, code: 400 };

      const { data: def } = await adminClient
        .from("fulfilment_step_defs").select("step_key, label").eq("step_key", stepKey).maybeSingle();
      if (!def) return { ok: false, error: `Unknown step: ${stepKey}`, code: 400 };

      const { data: prev } = await adminClient
        .from("company_fulfilment").select("status").eq("company_id", companyId).eq("step_key", stepKey).maybeSingle();
      const from = (prev?.status as string) || "pending";

      const settled = status === "done" || status === "skipped";
      const { data: row, error } = await adminClient
        .from("company_fulfilment")
        .upsert({
          company_id: companyId,
          step_key: stepKey,
          status,
          notes: notes ? notes.slice(0, 2000) : null,
          // completed_at is set by the table's trigger, so a reopened step
          // cannot keep a stale date. Attribution is ours to record.
          completed_by: settled ? caller.id : null,
          completed_by_name: settled ? actorName : null,
        }, { onConflict: "company_id,step_key" })
        .select("*").single();
      if (error) return { ok: false, error: error.message, code: 500 };

      await logAction({
        company_id: companyId,
        action: "fulfilment.step_set",
        step_key: stepKey,
        from_status: from,
        to_status: status,
        detail: { label: def.label, ...(notes ? { notes: notes.slice(0, 500) } : {}) },
      });
      await pushFulfilmentToMc(companyId);
      return { ok: true, step: row };
    };

    // ── Scope: the one definition of "which clients may this caller touch" ──
    // null = every client (admin or ops manager). A Set = exactly those.
    let _scopeCache: Set<string> | null | undefined;
    const resolveScope = async (): Promise<Set<string> | null> => {
      if (_scopeCache !== undefined) return _scopeCache;
      if (unrestricted) { _scopeCache = null; return null; }
      const { data } = await adminClient
        .from("team_assignments").select("company_id").eq("team_user_id", caller.id);
      _scopeCache = new Set((data || []).map((a: { company_id: string }) => a.company_id));
      return _scopeCache;
    };

    // ── The audit trail ─────────────────────────────────────────────────────
    // Append-only, internal-only, actor-attributed. Best effort by design: the
    // action it describes has already happened and a failed log line must not
    // roll it back or 500 the caller. A dropped line is visible as a gap; an
    // action undone because logging failed is a bug.
    const logAction = async (entry: {
      company_id?: string | null;
      action: string;
      step_key?: string | null;
      from_status?: string | null;
      to_status?: string | null;
      detail?: Record<string, unknown>;
    }) => {
      try {
        const { error } = await adminClient.from("fulfilment_log").insert({
          company_id: entry.company_id ?? null,
          actor_id: caller.id,
          actor_name: actorName,
          action: entry.action,
          step_key: entry.step_key ?? null,
          from_status: entry.from_status ?? null,
          to_status: entry.to_status ?? null,
          detail: entry.detail ?? {},
        });
        if (error) console.warn("fulfilment_log write failed:", error.message, entry.action);
      } catch (e) {
        console.warn("fulfilment_log threw:", (e as Error).message, entry.action);
      }
    };

    // ────────────────────── INTERNAL TEAM ACTIONS ──────────────────────────
    const TEAM_ACTIONS = new Set(["list_clients", "get_client", "add_note", "get_availability", "set_availability"]);
    if (TEAM_ACTIONS.has(action || "")) {
      // An admin who is not on the team can still use these to see the panel
      // the team sees; scope resolution below gives them everything.
      if (!isTeam && !isAdmin) return json({ error: "Forbidden: Internal Team access required" }, 403);

      // ── Weekly call availability (no client assignment needed) ──────────────
      if (action === "get_availability") {
        const { data: av } = await adminClient
          .from("team_availability").select("slots").eq("team_user_id", caller.id).maybeSingle();
        return json({ slots: av?.slots || [] });
      }
      if (action === "set_availability") {
        const raw = (body as { slots?: unknown }).slots;
        const slots = Array.isArray(raw)
          ? raw.filter((s): s is string => typeof s === "string" && /^(mon|tue|wed|thu|fri|sat|sun)-\d{1,2}$/.test(s)).slice(0, 200)
          : [];
        const { error } = await adminClient
          .from("team_availability")
          .upsert({ team_user_id: caller.id, slots, updated_at: new Date().toISOString() }, { onConflict: "team_user_id" });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, slots });
      }

      // The exact set of companies this caller may see. An ops manager or an
      // admin gets every client; a member gets their assignments. The rest of
      // this block works off a plain Set either way, so widening the tier did
      // not need the queries below touched.
      const scoped = await resolveScope();
      let allowedIds: Set<string>;
      if (scoped) {
        allowedIds = scoped;
      } else {
        const { data: all } = await adminClient.from("companies").select("id");
        allowedIds = new Set((all || []).map((c: { id: string }) => c.id));
      }

      if (action === "list_clients") {
        const ids = [...allowedIds];
        if (!ids.length) return json({ clients: [] });

        const { data: companies } = await adminClient
          .from("companies")
          .select("id, name, plan, email, phone")
          .in("id", ids)
          .order("name", { ascending: true });

        // Lead counts come from ppl_orders (the real fulfilment orders), NOT
        // ppl_lead_orders (Stripe checkouts - many clients have none).
        const { data: orders } = await adminClient
          .from("ppl_orders")
          .select("company_id, total_leads, delivered_leads, status")
          .in("company_id", ids);

        const { data: notes } = await adminClient
          .from("client_notes")
          .select("company_id")
          .in("company_id", ids);

        // Total leads in the account (for managed clients).
        const { data: leadRows } = await adminClient
          .from("leads")
          .select("company_id")
          .in("company_id", ids);

        const agg: Record<string, { totalLeads: number; delivered: number; activeOrders: number; notes: number; accountLeads: number }> = {};
        for (const id of ids) agg[id] = { totalLeads: 0, delivered: 0, activeOrders: 0, notes: 0, accountLeads: 0 };
        for (const o of orders || []) {
          const a = agg[o.company_id as string]; if (!a) continue;
          a.totalLeads += (o.total_leads as number) || 0;
          a.delivered += (o.delivered_leads as number) || 0;
          if (o.status === "active") a.activeOrders += 1;
        }
        for (const n of notes || []) { const a = agg[n.company_id as string]; if (a) a.notes += 1; }
        for (const l of leadRows || []) { const a = agg[l.company_id as string]; if (a) a.accountLeads += 1; }

        const clients = (companies || []).map((c: Record<string, unknown>) => ({
          id: c.id, name: c.name, plan: c.plan, email: c.email, phone: c.phone,
          ...agg[c.id as string],
        }));
        // The caller's own role travels with the list so the panel can label
        // itself honestly ("All clients" vs "Clients assigned to you") instead
        // of guessing from the row count.
        return json({
          clients,
          me: {
            team_role: isAdmin && !isTeam ? "admin" : ((me?.team_role as string) || "csm"),
            is_ops: isOps,
            is_admin: isAdmin,
            unrestricted,
            full_name: me?.full_name || null,
            // So the panel hides what this caller cannot use. The gate that
            // matters is server-side; this stops the UI offering a 403.
            can: perms,
          },
        });
      }

      const companyId = (body as { company_id?: string }).company_id;
      if (!companyId) return json({ error: "company_id is required" }, 400);
      if (!allowedIds.has(companyId)) return json({ error: "Forbidden: client not assigned to you" }, 403);

      if (action === "get_client") {
        const { data: company } = await adminClient
          .from("companies")
          .select("id, name, plan, email, phone, domain, created_at")
          .eq("id", companyId)
          .maybeSingle();
        if (!company) return json({ error: "Client not found" }, 404);

        const { data: members } = await adminClient
          .from("profiles")
          .select("id, full_name, phone, role")
          .eq("company_id", companyId);
        const emails = await emailMap(adminClient, (members || []).map((m: { id: string }) => m.id));
        const contacts = (members || []).map((m: Record<string, unknown>) => ({
          full_name: m.full_name, phone: m.phone, role: m.role, email: emails[m.id as string] || "",
        }));

        const { data: leadOrders } = await adminClient
          .from("ppl_lead_orders")
          .select("id, niche, area, quantity, delivered_count, price_per_lead, total_amount, status, created_at")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false });

        const { data: orders } = await adminClient
          .from("ppl_orders")
          .select("id, total_leads, delivered_leads, status, due_date, notes, created_at")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false });

        const { data: clientNotes } = await adminClient
          .from("client_notes")
          .select("id, body, author_name, created_at")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false });

        return json({
          company, contacts,
          lead_orders: leadOrders || [],
          orders: orders || [],
          notes: clientNotes || [],
        });
      }

      if (action === "add_note") {
        const noteBody = ((body as { body?: string }).body || "").trim();
        if (!noteBody) return json({ error: "Note body is required" }, 400);
        const { data: note, error } = await adminClient
          .from("client_notes")
          .insert({ company_id: companyId, author_id: caller.id, author_name: me?.full_name || "Internal Team", body: noteBody.slice(0, 5000) })
          .select("id, body, author_name, created_at")
          .single();
        if (error) return json({ error: error.message }, 500);
        await logAction({
          company_id: companyId, action: "note.added",
          detail: { note_id: note.id, chars: noteBody.length },
        });
        return json({ note });
      }
    }

    // ════════════════════════════ PREVIEW EMAIL ════════════════════════════
    // Step 6. The team attaches links and images (existing preview_links
    // actions), then presses send. Confirm-then-send, never automatic: this is
    // the email that asks the client to approve what goes live, and it should go
    // when a person has looked at it, not the moment an image finishes rendering.
    //
    // get_preview_draft returns the merged draft so it can be edited before
    // sending, the same shape as the intro email, so the two behave alike.
    const PREVIEW_EMAIL_ACTIONS = new Set(["get_preview_draft", "send_preview_email"]);
    if (PREVIEW_EMAIL_ACTIONS.has(action || "")) {
      if (!isTeam && !isAdmin) return json({ error: "Forbidden: Internal Team access required" }, 403);
      if (!can("preview_email_send")) {
        return json({ error: "Your role cannot send preview emails" }, 403);
      }
      const pScope = await resolveScope();
      const cid = (body as { company_id?: string }).company_id;
      if (!cid || (pScope && !pScope.has(cid))) {
        return json({ error: "Forbidden: client not assigned to you" }, 403);
      }

      const { data: co } = await adminClient
        .from("companies").select("id, name, email, generated_ad_copy").eq("id", cid).maybeSingle();
      if (!co) return json({ error: "Client not found" }, 404);

      const { data: links } = await adminClient
        .from("preview_links").select("id, kind, url, label, created_at")
        .eq("company_id", cid).order("created_at", { ascending: true });

      // The contact to address it to: the company email, else the first person
      // on the account.
      let to = String(co.email || "").trim().toLowerCase();
      let firstName = "";
      const { data: members } = await adminClient
        .from("profiles").select("id, full_name").eq("company_id", cid).limit(5);
      if (members?.length) {
        firstName = String(members[0].full_name || "").trim().split(/\s+/)[0] || "";
        if (!to) {
          const emails = await emailMap(adminClient, members.map((m: { id: string }) => m.id));
          to = String(emails[members[0].id as string] || "").toLowerCase();
        }
      }

      const senderName = actorName;
      const replyTo = (me?.team_reply_to_email as string) || caller.email || null;

      const buildDraft = () => {
        const chosen = (links || []);
        const linkLines = chosen
          .filter((l: Record<string, unknown>) => l.kind === "link")
          .map((l: Record<string, unknown>) => `  ${l.label ? l.label + ": " : ""}${l.url}`);
        const imageLines = chosen
          .filter((l: Record<string, unknown>) => l.kind === "image")
          .map((l: Record<string, unknown>) => `  ${l.label ? l.label + ": " : ""}${l.url}`);
        const copy = (co.generated_ad_copy || {}) as Record<string, unknown>;
        const headlines = Array.isArray(copy.headlines) ? (copy.headlines as string[]).slice(0, 3) : [];

        const lines = [
          `Hi ${firstName || "there"},`,
          "",
          `Your campaign is built and ready for you to look over before anything goes live.`,
          "",
        ];
        if (headlines.length) {
          lines.push("The headlines we are planning to test:", "");
          headlines.forEach((h) => lines.push(`  - ${h}`));
          lines.push("");
        }
        if (imageLines.length) {
          lines.push("Creatives:", "", ...imageLines, "");
        }
        if (linkLines.length) {
          lines.push("Preview links:", "", ...linkLines, "");
        }
        lines.push(
          "Have a read and tell me what you would like changed. Nothing runs and no budget is spent until you are happy with it.",
          "",
          "If it all looks right, just reply \"approved\" and we will launch.",
          "",
          senderName,
          "QuoteLeads",
        );
        return {
          subject: `Your campaign previews - ${co.name || "ready for approval"}`,
          body: lines.join("\n"),
        };
      };

      if (action === "get_preview_draft") {
        const draft = buildDraft();
        return json({
          to, reply_to: replyTo, ...draft,
          links: links || [],
          // So the panel can stop the team sending an empty preview email.
          has_previews: (links || []).length > 0,
          company: { id: co.id, name: co.name },
        });
      }

      // ── send_preview_email ──
      if (!to || !EMAIL_RE.test(to)) {
        return json({ error: "This client has no valid email address on file" }, 400);
      }
      if (!(links || []).length) {
        return json({ error: "Attach at least one preview link or image before sending" }, 400);
      }

      const subject = String((body as { subject?: string }).subject ?? "").trim() || buildDraft().subject;
      const text    = String((body as { body?: string }).body ?? "").trim() || buildDraft().body;
      if (subject.length > 300) return json({ error: "That subject is too long" }, 400);

      const sent = await sendEmail({ to, subject, text, fromName: "QuoteLeads", replyTo });
      if (!sent.ok) return json({ error: sent.error || "The email could not be sent" }, 502);

      await adminClient.from("client_email_log").insert({
        company_id: cid, kind: "campaign_previews", to_email: to, reply_to: replyTo,
        subject, body: text, sent_by: caller.id, sent_by_name: actorName,
        provider_id: sent.id ?? null,
      });

      // The step is ticked by whatever got a 2xx from Resend, not by remembering
      // to tick it - the same principle the intro email already follows.
      const res = await setStep(cid, "previews_sent", "done",
        `Sent to ${to} with ${(links || []).length} preview(s)`);
      if (!res.ok) console.warn("previews_sent step not recorded:", res.error);

      await logAction({
        company_id: cid, action: "preview_email.sent",
        detail: { to, subject: subject.slice(0, 200), preview_count: (links || []).length },
      });

      return json({ ok: true, to });
    }

    // ══════════════════════ ONBOARDING REVIEW QUEUE ════════════════════════
    // The held end of the spam gate. A submission whose email and phone appear
    // nowhere in the ql-mc pipeline never became an account; this is where a
    // human decides.
    //
    // Approving CREATES AN ACCOUNT and emails a real person, so it is limited to
    // an ops manager or an admin - the same line drawn everywhere else: an ops
    // manager runs fulfilment, a CSM or media buyer does not mint accounts.
    const SUBMISSION_ACTIONS = new Set([
      "list_submissions", "get_submission", "approve_submission", "reject_submission",
    ]);
    if (SUBMISSION_ACTIONS.has(action || "")) {
      // Approving creates an account and emails a real person, so it is its own
      // capability rather than a side effect of being an ops manager.
      if (!can("signups_review")) {
        return json({ error: "Your role cannot review signups" }, 403);
      }

      if (action === "list_submissions") {
        // Held first: that is the queue. Everything else is history.
        const status = (body as { status?: string }).status;
        let q = adminClient
          .from("onboarding_submissions")
          .select("id, email, first_name, last_name, company, phone, industry, service_location, " +
                  "gate_status, gate_checked_at, gate_detail, company_id, account_created_at, " +
                  "welcome_email_sent_at, reviewed_by_name, reviewed_at, review_notes, last_error, created_at")
          .order("created_at", { ascending: false })
          .limit(200);
        if (status && ["pending", "matched", "held", "approved", "rejected"].includes(status)) {
          q = q.eq("gate_status", status);
        }
        const { data, error } = await q;
        if (error) return json({ error: error.message }, 500);
        const rows = data || [];
        return json({
          submissions: rows,
          counts: {
            held:     rows.filter((r: Record<string, unknown>) => r.gate_status === "held").length,
            pending:  rows.filter((r: Record<string, unknown>) => r.gate_status === "pending").length,
            approved: rows.filter((r: Record<string, unknown>) => r.gate_status === "approved").length,
            rejected: rows.filter((r: Record<string, unknown>) => r.gate_status === "rejected").length,
            matched:  rows.filter((r: Record<string, unknown>) => r.gate_status === "matched").length,
          },
        });
      }

      const subId = (body as { id?: string }).id;
      if (!subId) return json({ error: "id is required" }, 400);

      if (action === "get_submission") {
        const { data, error } = await adminClient
          .from("onboarding_submissions").select("*").eq("id", subId).maybeSingle();
        if (error) return json({ error: error.message }, 500);
        if (!data) return json({ error: "Submission not found" }, 404);
        return json({ submission: data });
      }

      if (action === "reject_submission") {
        const notes = String((body as { notes?: string }).notes ?? "").trim();
        // Rejecting is a judgement someone has to own, so it needs a reason.
        if (!notes) return json({ error: "Say why you are rejecting it" }, 400);
        const { error } = await adminClient.from("onboarding_submissions").update({
          gate_status: "rejected",
          reviewed_by: caller.id,
          reviewed_by_name: actorName,
          reviewed_at: new Date().toISOString(),
          review_notes: notes.slice(0, 2000),
        }).eq("id", subId);
        if (error) return json({ error: error.message }, 500);
        // No company_id yet, so this log line is not attached to a client. It is
        // still worth keeping: someone decided not to onboard a signup.
        await logAction({
          company_id: null, action: "onboarding.rejected",
          detail: { submission_id: subId, notes: notes.slice(0, 500) },
        });
        return json({ ok: true });
      }

      if (action === "approve_submission") {
        const notes = String((body as { notes?: string }).notes ?? "").trim();
        const { data: sub } = await adminClient
          .from("onboarding_submissions").select("*").eq("id", subId).maybeSingle();
        if (!sub) return json({ error: "Submission not found" }, 404);
        if (sub.company_id) {
          return json({ error: "That submission already has an account", company_id: sub.company_id }, 409);
        }

        await adminClient.from("onboarding_submissions").update({
          gate_status: "approved",
          reviewed_by: caller.id,
          reviewed_by_name: actorName,
          reviewed_at: new Date().toISOString(),
          review_notes: notes ? notes.slice(0, 2000) : null,
        }).eq("id", subId);

        // Provisioning lives in growth-onboarding, and is called rather than
        // reimplemented here: two implementations of "create the account and
        // send the welcome email" is exactly how the manual path and the
        // automatic path drift into behaving differently.
        const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/growth-onboarding`;
        let provisioned: Record<string, unknown> = {};
        try {
          const res = await fetch(fnUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              // Tells growth-onboarding this is an approved submission being
              // released, not a fresh form post: skip capture and the gate, just
              // provision. The header is only honoured for a service-role call.
              "x-provision-submission": subId,
            },
            body: JSON.stringify({ submission_id: subId }),
          });
          provisioned = await res.json().catch(() => ({}));
          if (!res.ok) {
            await adminClient.from("onboarding_submissions").update({
              last_error: String(provisioned?.error || `HTTP ${res.status}`).slice(0, 1000),
              error_at: new Date().toISOString(),
            }).eq("id", subId);
            return json({ error: `Approved, but the account could not be created: ${provisioned?.error || res.status}` }, 502);
          }
        } catch (e) {
          const msg = (e as Error).message;
          await adminClient.from("onboarding_submissions").update({
            last_error: msg.slice(0, 1000), error_at: new Date().toISOString(),
          }).eq("id", subId);
          return json({ error: `Approved, but provisioning failed: ${msg}` }, 502);
        }

        await logAction({
          company_id: (provisioned?.company_id as string) ?? null,
          action: "onboarding.approved",
          detail: { submission_id: subId, notes: notes.slice(0, 500) || null },
        });
        return json({ ok: true, ...provisioned });
      }
    }

    // ═════════════════════════════ FULFILMENT ══════════════════════════════
    // What we owe each client, how far through it we are, who did it and when.
    // Open to the whole Internal Team: a member for their assigned clients, an
    // ops manager or admin for every client.
    const FULFILMENT_ACTIONS = new Set([
      "list_fulfilment", "set_fulfilment_step", "fulfilment_overview", "list_fulfilment_log",
    ]);
    if (FULFILMENT_ACTIONS.has(action || "")) {
      if (!isTeam && !isAdmin) return json({ error: "Forbidden: Internal Team access required" }, 403);
      // A CSM has no business in the fulfilment checklist, so the section is
      // behind a capability instead of being open to everyone on the team.
      if (!can("fulfilment_view")) {
        return json({ error: "Your role does not have access to fulfilment" }, 403);
      }
      if (action === "set_fulfilment_step" && !can("fulfilment_edit")) {
        return json({ error: "Your role can view fulfilment but not change it" }, 403);
      }

      // The /admin preview picks a team member and shows the panel as they see
      // it. Without this the fulfilment board ignored that choice: the caller is
      // still the admin, so resolveScope returned unrestricted and the board
      // showed every client while the client list next to it showed five. A
      // preview that quietly widens what it is previewing is worse than no
      // preview - so an admin or ops manager may narrow to one member's
      // assignments, and the narrowing is applied HERE rather than trusted from
      // the browser.
      //
      // It can only ever narrow. A plain member passing this gets their own
      // scope regardless of whose id they send, so it cannot be used to read
      // another member's clients.
      let fScope = await resolveScope();
      const asUser = String((body as { as_team_user_id?: string }).as_team_user_id ?? "").trim();
      if (asUser && (isAdmin || isOps)) {
        const { data: theirs } = await adminClient
          .from("team_assignments").select("company_id").eq("team_user_id", asUser);
        fScope = new Set((theirs || []).map((a: { company_id: string }) => a.company_id));
      }

      // Guard every company reference the same way, once.
      const mayTouch = (cid: string | undefined): cid is string =>
        !!cid && (!fScope || fScope.has(cid));

      // ── The whole board: one row per client, ordered by what is late ─────
      if (action === "fulfilment_overview") {
        let cq = adminClient.from("companies").select("id, name, plan, created_at");
        if (fScope) {
          const ids = [...fScope];
          if (!ids.length) return json({ clients: [], steps: [] });
          cq = cq.in("id", ids);
        }
        const { data: companies, error: cErr } = await cq;
        if (cErr) return json({ error: cErr.message }, 500);

        const ids = (companies || []).map((c: { id: string }) => c.id);
        const safeIds = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
        const { data: sums } = await adminClient
          .from("company_fulfilment_summary")
          .select("*").in("company_id", safeIds);
        const { data: defs } = await adminClient
          .from("fulfilment_step_defs")
          .select("step_key, label, phase, sort_order, owner_role, required, sla_hours")
          .eq("active", true).order("sort_order", { ascending: true });

        const sumBy: Record<string, Record<string, unknown>> = {};
        for (const r of sums || []) sumBy[r.company_id as string] = r;
        const now = Date.now();

        const clients = (companies || []).map((c: Record<string, unknown>) => {
          const sum = sumBy[c.id as string] || null;
          const due = sum?.next_step_due ? new Date(sum.next_step_due as string).getTime() : null;
          return {
            id: c.id, name: c.name, plan: c.plan, created_at: c.created_at,
            stage: sum?.stage ?? null,
            active_status: sum?.active_status ?? null,
            steps_done: sum?.steps_done ?? 0,
            steps_settled: sum?.steps_settled ?? 0,
            steps_total: sum?.steps_total ?? 0,
            blocked_count: sum?.blocked_count ?? 0,
            next_step_key: sum?.next_step_key ?? null,
            next_step_due: sum?.next_step_due ?? null,
            // Surfaced rather than left to the page to recompute, so the panel
            // and ql-mc's stuck list agree on what "late" means.
            overdue: due != null && due < now,
            overdue_hours: due != null && due < now ? Math.floor((now - due) / 3600000) : 0,
            complete: (sum?.next_step_key ?? null) === null,
          };
        });
        // Most overdue first, then blocked, then furthest behind.
        clients.sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          (b.overdue_hours as number) - (a.overdue_hours as number) ||
          (b.blocked_count as number) - (a.blocked_count as number) ||
          (a.steps_settled as number) - (b.steps_settled as number));
        return json({ clients, steps: defs || [] });
      }

      const cid = (body as { company_id?: string }).company_id;
      if (!mayTouch(cid)) return json({ error: "Forbidden: client not assigned to you" }, 403);

      // ── One client's checklist, with its history ─────────────────────────
      if (action === "list_fulfilment") {
        const { data: defs } = await adminClient
          .from("fulfilment_step_defs")
          .select("step_key, label, phase, sort_order, owner_role, required, sla_hours")
          .eq("active", true).order("sort_order", { ascending: true });
        const { data: rows } = await adminClient
          .from("company_fulfilment")
          .select("step_key, status, completed_at, completed_by_name, notes, started_at, updated_at")
          .eq("company_id", cid);
        const { data: sum } = await adminClient
          .from("company_fulfilment_summary").select("*").eq("company_id", cid).maybeSingle();

        const byKey: Record<string, Record<string, unknown>> = {};
        for (const r of rows || []) byKey[r.step_key as string] = r;
        // A step with no row is pending. Returning it explicitly means a new
        // step added to the catalogue shows up for every client with no
        // backfill, and the page never has to know that absence means pending.
        const steps = (defs || []).map((d: Record<string, unknown>) => ({
          ...d,
          status: (byKey[d.step_key as string]?.status as string) || "pending",
          completed_at: byKey[d.step_key as string]?.completed_at ?? null,
          completed_by_name: byKey[d.step_key as string]?.completed_by_name ?? null,
          notes: byKey[d.step_key as string]?.notes ?? null,
          started_at: byKey[d.step_key as string]?.started_at ?? null,
        }));
        const { data: log } = await adminClient
          .from("fulfilment_log")
          .select("id, action, step_key, from_status, to_status, actor_name, detail, created_at")
          .eq("company_id", cid).order("created_at", { ascending: false }).limit(100);
        return json({ steps, summary: sum || null, log: log || [] });
      }

      // ── Move a step ─────────────────────────────────────────────────────
      if (action === "set_fulfilment_step") {
        const b = body as { step_key?: string; status?: string; notes?: string };
        if (!b.step_key) return json({ error: "step_key is required" }, 400);
        if (!b.status) return json({ error: "status is required" }, 400);
        // A blocked step with no reason is not information anyone can act on.
        if (b.status === "blocked" && !(b.notes || "").trim()) {
          return json({ error: "Say what it is blocked on" }, 400);
        }
        const res = await setStep(cid, b.step_key, b.status, (b.notes || "").trim() || null);
        if (!res.ok) return json({ error: res.error }, res.code);

        // The intro email step and companies.intro_email_sent are the same fact
        // read by two panels; keep them in step whichever side moved.
        if (b.step_key === "intro_email_sent") {
          const done = b.status === "done";
          await adminClient.from("companies")
            .update({ intro_email_sent: done, intro_email_sent_at: done ? new Date().toISOString() : null })
            .eq("id", cid);
        }
        // Same for the ads-live date the billing panel shows.
        if (b.step_key === "ads_live" && b.status === "done") {
          const { data: co } = await adminClient
            .from("companies").select("ads_live_date").eq("id", cid).maybeSingle();
          if (!co?.ads_live_date) {
            await adminClient.from("companies")
              .update({ ads_live_date: new Date().toISOString().slice(0, 10) }).eq("id", cid);
          }
        }
        return json({ ok: true, step: res.step });
      }

      // ── The trail for one client ────────────────────────────────────────
      if (action === "list_fulfilment_log") {
        const limit = Math.min(Math.max(Number((body as { limit?: number }).limit) || 200, 1), 500);
        const { data: log } = await adminClient
          .from("fulfilment_log")
          .select("id, action, step_key, from_status, to_status, actor_name, detail, created_at")
          .eq("company_id", cid).order("created_at", { ascending: false }).limit(limit);
        return json({ log: log || [] });
      }
    }

    // ═══════════════════════════ BILLING / INVOICING ═══════════════════════
    // Shared by /admin (full control) and /team-panel (create + read only).
    // Access split:
    //   • Admin  → everything below.
    //   • Team   → billing_list (assigned only), create_invoice, list_invoices,
    //              get_bank_details (READ-ONLY). Never set_bank_details, never
    //              billing_update_company, never delete_invoice.
    const TEAM_BILLING_ACTIONS = new Set(["billing_list", "list_invoices", "create_invoice", "get_bank_details", "mark_intro_email_sent"]);
    const isBillingAction = [
      "billing_list", "billing_update_company", "list_invoices", "create_invoice",
      "update_invoice", "delete_invoice", "get_bank_details", "set_bank_details", "mark_intro_email_sent",
    ].includes(action || "");

    if (isBillingAction) {
      // An ops manager gets the admin-side billing actions too: they own the
      // fulfilment of every client, and chasing an unpaid invoice is part of
      // that. set_bank_details and delete_invoice stay admin-only below.
      const OPS_BILLING_ACTIONS = new Set([
        "billing_list", "list_invoices", "create_invoice", "update_invoice",
        "get_bank_details", "mark_intro_email_sent", "billing_update_company",
      ]);
      // Reading billing state is part of seeing a client at all; creating or
      // changing an invoice is the capability. mark_intro_email_sent rides with
      // the intro email rather than with invoicing.
      const READ_ONLY_BILLING = new Set(["billing_list", "list_invoices", "get_bank_details"]);
      const mayBill = isAdmin
        || (isTeam && READ_ONLY_BILLING.has(action || ""))
        || (isTeam && action === "mark_intro_email_sent" && can("intro_email_send"))
        || (isTeam && can("invoices_manage") && OPS_BILLING_ACTIONS.has(action || ""));
      if (!mayBill) return json({ error: "Your role cannot do that with invoices" }, 403);

      // Restrict every company reference to what this caller may touch.
      // null = every client (admin or ops manager).
      const scopedIds: Set<string> | null = await resolveScope();

      // ── List all clients with their billing state + delivery + invoices ──
      if (action === "billing_list") {
        let q = adminClient
          .from("companies")
          .select("id, name, email, phone, plan, created_at, payment_method, ads_live_date, next_invoice_due, invoice_status, intro_email_sent, intro_email_sent_at, management_fee_cents");
        if (scopedIds) {
          const ids = [...scopedIds];
          if (!ids.length) return json({ clients: [] });
          q = q.in("id", ids);
        }
        const { data: companies, error: cErr } = await q.order("created_at", { ascending: false });
        if (cErr) return json({ error: cErr.message }, 500);
        const ids = (companies || []).map((c: { id: string }) => c.id);
        const safeIds = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];

        const { data: orders } = await adminClient
          .from("ppl_orders").select("company_id, total_leads, delivered_leads, status").in("company_id", safeIds);
        const { data: invs } = await adminClient
          .from("invoices")
          .select("id, company_id, invoice_number, status, total, invoice_date, due_date, created_at")
          .in("company_id", safeIds).order("created_at", { ascending: false });

        const agg: Record<string, { delivered: number; total: number; activeOrders: number }> = {};
        for (const id of ids) agg[id] = { delivered: 0, total: 0, activeOrders: 0 };
        for (const o of orders || []) {
          const a = agg[o.company_id as string]; if (!a) continue;
          a.total += (o.total_leads as number) || 0;
          a.delivered += (o.delivered_leads as number) || 0;
          if (o.status === "active") a.activeOrders += 1;
        }
        const invByCo: Record<string, unknown[]> = {};
        for (const inv of invs || []) (invByCo[inv.company_id as string] ||= []).push(inv);

        const clients = (companies || []).map((c: Record<string, unknown>) => ({
          ...c,
          delivery: agg[c.id as string] || { delivered: 0, total: 0, activeOrders: 0 },
          invoices: invByCo[c.id as string] || [],
        }));
        return json({ clients });
      }

      // ── Mark the intro email sent (team or admin, assigned only) ─────────
      if (action === "mark_intro_email_sent") {
        const cid = (body as { company_id?: string }).company_id;
        if (!cid) return json({ error: "company_id is required" }, 400);
        if (scopedIds && !scopedIds.has(cid)) return json({ error: "Forbidden" }, 403);
        const done = (body as { done?: boolean }).done !== false; // default true
        const { error } = await adminClient.from("companies")
          .update({ intro_email_sent: done, intro_email_sent_at: done ? new Date().toISOString() : null })
          .eq("id", cid);
        if (error) return json({ error: error.message }, 500);
        // The boolean and the step are the same fact. Write both from one place
        // so the billing panel (which reads the column) and the fulfilment
        // checklist (which reads the step) can never disagree.
        await setStep(cid, "intro_email_sent", done ? "done" : "pending", null);
        return json({ ok: true, intro_email_sent: done });
      }

      // ── Update a company's billing / onboarding fields (admin only) ──────
      if (action === "billing_update_company") {
        const { company_id, fields } = body as { company_id?: string; fields?: Record<string, unknown> };
        if (!company_id) return json({ error: "company_id is required" }, 400);
        const f = fields || {};
        const upd: Record<string, unknown> = {};
        const allowed = ["payment_method", "ads_live_date", "next_invoice_due", "invoice_status", "intro_email_sent", "management_fee_cents"];
        for (const k of allowed) if (k in f) upd[k] = f[k] === "" ? null : f[k];
        if ("payment_method" in upd && upd.payment_method != null && !["invoice", "stripe"].includes(upd.payment_method as string)) {
          return json({ error: "payment_method must be 'invoice' or 'stripe'" }, 400);
        }
        if ("invoice_status" in upd && upd.invoice_status != null && !["none", "due", "sent", "paid", "unpaid"].includes(upd.invoice_status as string)) {
          return json({ error: "invalid invoice_status" }, 400);
        }
        if ("intro_email_sent" in upd) upd.intro_email_sent_at = upd.intro_email_sent ? new Date().toISOString() : null;
        // The per-client management fee, in cents. Empty clears it back to the
        // standard price rather than storing 0, which would mean free.
        if ("management_fee_cents" in upd) {
          if (upd.management_fee_cents == null || upd.management_fee_cents === "") {
            upd.management_fee_cents = null;
          } else {
            const n = Math.round(Number(upd.management_fee_cents));
            if (!Number.isFinite(n) || n < 0 || n > 5_000_000) {
              return json({ error: "That management fee looks wrong. Enter an amount between $0 and $50,000." }, 400);
            }
            upd.management_fee_cents = n;
          }
        }
        if (!Object.keys(upd).length) return json({ error: "no updatable fields provided" }, 400);
        const { error } = await adminClient.from("companies").update(upd).eq("id", company_id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ── List invoices (optionally for one company) ───────────────────────
      if (action === "list_invoices") {
        const companyId = (body as { company_id?: string }).company_id;
        let q = adminClient.from("invoices").select("*").order("created_at", { ascending: false });
        if (companyId) {
          if (scopedIds && !scopedIds.has(companyId)) return json({ error: "Forbidden" }, 403);
          q = q.eq("company_id", companyId);
        } else if (scopedIds) {
          const ids = [...scopedIds];
          if (!ids.length) return json({ invoices: [] });
          q = q.in("company_id", ids);
        }
        const { data, error } = await q.limit(500);
        if (error) return json({ error: error.message }, 500);
        return json({ invoices: data || [] });
      }

      // ── Create an invoice ────────────────────────────────────────────────
      if (action === "create_invoice") {
        const inv = (body as { invoice?: Record<string, unknown> }).invoice || {};
        const companyId = inv.company_id as string | undefined;
        if (scopedIds && (!companyId || !scopedIds.has(companyId))) {
          return json({ error: "Forbidden: client not assigned to you" }, 403);
        }
        const row = sanitizeInvoice(inv);
        row.created_by = caller.id;
        const { data, error } = await adminClient.from("invoices").insert(row).select("*").single();
        if (error) return json({ error: error.message }, 500);
        await logAction({
          company_id: companyId || null, action: "invoice.created",
          detail: { invoice_id: data.id, invoice_number: data.invoice_number, total: data.total },
        });
        return json({ invoice: data });
      }

      // ── Update an invoice (admin only: status, fields) ───────────────────
      if (action === "update_invoice") {
        const id = (body as { id?: string }).id;
        if (!id) return json({ error: "id is required" }, 400);
        const patch = (body as { patch?: Record<string, unknown> }).patch || {};
        const row = sanitizeInvoice(patch, true);
        row.updated_at = new Date().toISOString();
        if (!Object.keys(row).length) return json({ error: "no fields to update" }, 400);
        const { data, error } = await adminClient.from("invoices").update(row).eq("id", id).select("*").single();
        if (error) return json({ error: error.message }, 500);
        await logAction({
          company_id: (data.company_id as string) || null, action: "invoice.updated",
          detail: { invoice_id: data.id, invoice_number: data.invoice_number, changed: Object.keys(row) },
        });
        return json({ invoice: data });
      }

      // ── Delete an invoice (admin only) ───────────────────────────────────
      if (action === "delete_invoice") {
        const id = (body as { id?: string }).id;
        if (!id) return json({ error: "id is required" }, 400);
        // Read it before it goes, so the log can say which invoice was deleted
        // rather than just that one was.
        const { data: doomed } = await adminClient
          .from("invoices").select("company_id, invoice_number, total").eq("id", id).maybeSingle();
        const { error } = await adminClient.from("invoices").delete().eq("id", id);
        if (error) return json({ error: error.message }, 500);
        await logAction({
          company_id: (doomed?.company_id as string) || null, action: "invoice.deleted",
          detail: { invoice_id: id, invoice_number: doomed?.invoice_number ?? null, total: doomed?.total ?? null },
        });
        return json({ ok: true });
      }

      // ── Bank / business settings ─────────────────────────────────────────
      if (action === "get_bank_details") {
        const { data } = await adminClient.from("business_settings").select("*").eq("id", 1).maybeSingle();
        return json({ settings: data || {}, can_edit: isAdmin });
      }
      if (action === "set_bank_details") {
        // Admin only - team members never reach here (guarded above).
        const s = (body as { settings?: Record<string, unknown> }).settings || {};
        const allowed = ["business_name", "abn", "bank_name", "account_name", "bsb", "account_number", "payment_details", "logo_url"];
        const upd: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
        for (const k of allowed) if (k in s) upd[k] = s[k];
        const { error } = await adminClient.from("business_settings").upsert(upd, { onConflict: "id" });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
    }

    // ═══════════════════ ONBOARDING / INTRO EMAIL ══════════════════════════
    // A team member may only email a client assigned to them; an admin any.
    // The send is what sets companies.intro_email_sent, so the tick on the task
    // list means Resend accepted the message, not that someone remembered to
    // click it.
    const INTRO_ACTIONS = new Set(["get_intro_draft", "send_intro_email"]);
    if (INTRO_ACTIONS.has(action || "")) {
      if (!isAdmin && !isTeam) return json({ error: "Forbidden" }, 403);
      if (!can("intro_email_send")) {
        return json({ error: "Your role cannot send the intro email" }, 403);
      }
      const companyId = (body as { company_id?: string }).company_id;
      if (!companyId) return json({ error: "company_id is required" }, 400);

      if (!isAdmin) {
        const { data: assigns } = await adminClient
          .from("team_assignments").select("company_id").eq("team_user_id", caller.id);
        const allowed = new Set((assigns || []).map((a: { company_id: string }) => a.company_id));
        if (!allowed.has(companyId)) return json({ error: "Forbidden" }, 403);
      }

      const { data: company } = await adminClient
        .from("companies")
        .select("id, name, email, intro_email_sent")
        .eq("id", companyId)
        .maybeSingle();
      if (!company) return json({ error: "Company not found" }, 404);

      // The company email is the billing address; the owner's login is who
      // actually reads it, so prefer that and fall back.
      const { data: owner } = await adminClient
        .from("profiles")
        .select("id, full_name")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const ownerEmails = owner?.id ? await emailMap(adminClient, [owner.id as string]) : {};
      const to = String((owner?.id ? ownerEmails[owner.id as string] : "") || company.email || "").trim();
      const contactName = String(owner?.full_name || "").trim();

      const vaName = String(me?.full_name || "").trim();
      const { data: myProfile } = await adminClient
        .from("profiles").select("team_reply_to_email").eq("id", caller.id).maybeSingle();
      const replyTo = String(myProfile?.team_reply_to_email || caller.email || "").trim();

      const vals: Record<string, string> = {
        first_name:   contactName ? contactName.split(/\s+/)[0] : "",
        contact_name: contactName,
        company_name: String(company.name || "").trim(),
        va_name:      vaName,
        va_email:     replyTo,
      };

      if (action === "get_intro_draft") {
        const { data: tpl } = await adminClient
          .from("email_templates").select("subject, body").eq("slug", "onboarding_intro").maybeSingle();
        if (!tpl) return json({ error: "No onboarding_intro template found" }, 404);
        return json({
          to, reply_to: replyTo, already_sent: company.intro_email_sent === true,
          subject: mergeTemplate(tpl.subject || "", vals),
          body: mergeTemplate(tpl.body || "", vals),
        });
      }

      // send_intro_email
      const subject = String((body as { subject?: string }).subject ?? "").trim();
      const text    = String((body as { body?: string }).body ?? "").trim();
      if (!to || !EMAIL_RE.test(to)) return json({ error: "This client has no valid email address" }, 400);
      if (!subject) return json({ error: "Subject is required" }, 400);
      if (!text) return json({ error: "Body is required" }, 400);
      if (subject.length > 300 || text.length > 20000) return json({ error: "Email is too long" }, 400);
      if (company.intro_email_sent) return json({ error: "The intro email has already been sent" }, 409);

      const sent = await sendEmail({
        to, subject, text,
        fromName: vaName ? `${vaName} at QuoteLeads` : "QuoteLeads",
        replyTo,
      });
      if (!sent.ok) return json({ error: sent.error || "Send failed" }, 502);

      // Only now is it marked done - a failed send leaves the task open.
      await adminClient.from("companies")
        .update({ intro_email_sent: true, intro_email_sent_at: new Date().toISOString() })
        .eq("id", companyId);
      await adminClient.from("client_email_log").insert({
        company_id: companyId, kind: "onboarding_intro", to_email: to, reply_to: replyTo || null,
        subject, body: text, sent_by: caller.id, sent_by_name: vaName || null, provider_id: sent.id || null,
      });
      // The email is already in client_email_log; this puts it on the client's
      // fulfilment timeline too, so one view answers "what happened to them".
      await logAction({
        company_id: companyId, action: "intro_email.sent",
        step_key: "intro_email_sent", detail: { subject: String(subject).slice(0, 200) },
      });
      return json({ ok: true, to, reply_to: replyTo || null });
    }

    // ═══════════════════ DFY CONTENT: profile / previews / templates ═══════
    // Shared by /admin and /team-panel. Company-scoped actions require the
    // caller to own the assignment; email templates are global (team or admin).
    const DFY_COMPANY_ACTIONS = new Set([
      "get_dfy", "save_dfy", "list_preview_links", "add_preview_link", "add_preview_image", "delete_preview_link",
    ]);
    const TEMPLATE_ACTIONS = new Set(["list_email_templates", "save_email_template", "delete_email_template"]);
    const isDfyAction = DFY_COMPANY_ACTIONS.has(action || "") || TEMPLATE_ACTIONS.has(action || "");

    if (isDfyAction) {
      if (!isAdmin && !isTeam) return json({ error: "Forbidden" }, 403);

      let scopedDfy: Set<string> | null = null;
      if (!isAdmin) {
        const { data: assigns } = await adminClient
          .from("team_assignments").select("company_id").eq("team_user_id", caller.id);
        scopedDfy = new Set((assigns || []).map((a: { company_id: string }) => a.company_id));
      }
      const ensureCompany = (cid?: string): string | null => {
        if (!cid) return null;
        if (scopedDfy && !scopedDfy.has(cid)) return null;
        return cid;
      };

      // ── DFY profile (service area + onboarding + campaign prefs) ─────────
      if (action === "get_dfy") {
        const cid = ensureCompany((body as { company_id?: string }).company_id);
        if (!cid) return json({ error: "Forbidden or missing company_id" }, 403);
        const { data } = await adminClient
          .from("companies").select("id, name, plan, dfy_profile").eq("id", cid).maybeSingle();
        if (!data) return json({ error: "Client not found" }, 404);
        return json({ profile: data.dfy_profile || {}, company: { id: data.id, name: data.name, plan: data.plan } });
      }
      if (action === "save_dfy") {
        const cid = ensureCompany((body as { company_id?: string }).company_id);
        if (!cid) return json({ error: "Forbidden or missing company_id" }, 403);
        const profile = (body as { profile?: unknown }).profile;
        if (typeof profile !== "object" || profile === null || Array.isArray(profile)) {
          return json({ error: "profile must be an object" }, 400);
        }
        const { error } = await adminClient.from("companies").update({ dfy_profile: profile }).eq("id", cid);
        if (error) return json({ error: error.message }, 500);
        await logAction({
          company_id: cid, action: "dfy.saved",
          detail: { fields: Object.keys(profile as Record<string, unknown>) },
        });
        return json({ ok: true });
      }

      // ── Preview links / screenshots ──────────────────────────────────────
      if (action === "list_preview_links") {
        const cid = ensureCompany((body as { company_id?: string }).company_id);
        if (!cid) return json({ error: "Forbidden or missing company_id" }, 403);
        const { data } = await adminClient
          .from("preview_links").select("*").eq("company_id", cid).order("created_at", { ascending: false });
        return json({ links: data || [] });
      }
      if (action === "add_preview_link") {
        const cid = ensureCompany((body as { company_id?: string }).company_id);
        if (!cid) return json({ error: "Forbidden or missing company_id" }, 403);
        const url = ((body as { url?: string }).url || "").trim();
        if (!url) return json({ error: "url is required" }, 400);
        if (!/^https?:\/\//i.test(url)) return json({ error: "url must start with http(s)://" }, 400);
        const kind = (body as { kind?: string }).kind === "image" ? "image" : "link";
        const label = ((body as { label?: string }).label || "").trim().slice(0, 300) || null;
        const { data, error } = await adminClient
          .from("preview_links")
          .insert({ company_id: cid, kind, url: url.slice(0, 2000), label, created_by: caller.id })
          .select("*").single();
        if (error) return json({ error: error.message }, 500);
        await logAction({ company_id: cid, action: "preview.added", detail: { kind, label, url: url.slice(0, 300) } });
        return json({ link: data });
      }
      // ── Upload a screenshot from the user's computer to Storage ──────────
      if (action === "add_preview_image") {
        const cid = ensureCompany((body as { company_id?: string }).company_id);
        if (!cid) return json({ error: "Forbidden or missing company_id" }, 403);
        const b = body as { data?: string; filename?: string; content_type?: string; label?: string };
        if (!b.data) return json({ error: "data (base64) is required" }, 400);
        const contentType = b.content_type || "image/png";
        if (!/^image\/(png|jpe?g|gif|webp)$/i.test(contentType)) {
          return json({ error: "Only PNG, JPG, GIF or WEBP images are allowed" }, 400);
        }
        // Decode base64 (accepts a bare base64 string or a data: URL).
        let bytes: Uint8Array;
        try {
          const raw = b.data.includes(",") ? b.data.slice(b.data.indexOf(",") + 1) : b.data;
          const bin = atob(raw);
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } catch {
          return json({ error: "Invalid image data" }, 400);
        }
        if (bytes.length > 10 * 1024 * 1024) return json({ error: "Image exceeds 10 MB limit" }, 400);
        const ext = (contentType.split("/")[1] || "png").replace("jpeg", "jpg");
        const path = `${cid}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await adminClient.storage
          .from("preview-images").upload(path, bytes, { contentType, upsert: false });
        if (upErr) return json({ error: upErr.message }, 500);
        const { data: pub } = adminClient.storage.from("preview-images").getPublicUrl(path);
        const label = ((b.filename || "").trim().slice(0, 300)) || null;
        const { data, error } = await adminClient
          .from("preview_links")
          .insert({ company_id: cid, kind: "image", url: pub.publicUrl, label, created_by: caller.id })
          .select("*").single();
        if (error) return json({ error: error.message }, 500);
        await logAction({ company_id: cid, action: "preview.added", detail: { kind: "image", label } });
        return json({ link: data });
      }

      if (action === "delete_preview_link") {
        const id = (body as { id?: string }).id;
        if (!id) return json({ error: "id is required" }, 400);
        // VA may only delete a link on a company they're assigned to.
        // Read it first for both reasons: the scope check needs the company, and
        // so does the log line once the row is gone.
        const { data: row } = await adminClient
          .from("preview_links").select("company_id, kind, label").eq("id", id).maybeSingle();
        if (scopedDfy && (!row || !scopedDfy.has(row.company_id as string))) {
          return json({ error: "Forbidden" }, 403);
        }
        const { error } = await adminClient.from("preview_links").delete().eq("id", id);
        if (error) return json({ error: error.message }, 500);
        await logAction({
          company_id: (row?.company_id as string) || null, action: "preview.deleted",
          detail: { kind: row?.kind ?? null, label: row?.label ?? null },
        });
        return json({ ok: true });
      }

      // ── Email templates (global) ─────────────────────────────────────────
      if (action === "list_email_templates") {
        const { data } = await adminClient
          .from("email_templates").select("*").order("name", { ascending: true });
        return json({ templates: data || [] });
      }
      if (action === "save_email_template") {
        const t = (body as { template?: Record<string, unknown> }).template || {};
        const name = String(t.name || "").trim();
        if (!name) return json({ error: "name is required" }, 400);
        const row: Record<string, unknown> = {
          name: name.slice(0, 200),
          subject: t.subject != null ? String(t.subject).slice(0, 500) : null,
          body: t.body != null ? String(t.body).slice(0, 20000) : null,
          updated_at: new Date().toISOString(),
        };
        if (t.id) {
          const { data, error } = await adminClient.from("email_templates").update(row).eq("id", t.id).select("*").single();
          if (error) return json({ error: error.message }, 500);
          return json({ template: data });
        }
        row.created_by = caller.id;
        const { data, error } = await adminClient.from("email_templates").insert(row).select("*").single();
        if (error) return json({ error: error.message }, 500);
        return json({ template: data });
      }
      if (action === "delete_email_template") {
        const id = (body as { id?: string }).id;
        if (!id) return json({ error: "id is required" }, 400);
        // A slugged template is wired to a button (onboarding_intro backs Send
        // intro email). Deleting it breaks that flow with nothing to fall back
        // on, so it can be edited but not removed.
        const { data: existing } = await adminClient
          .from("email_templates").select("slug").eq("id", id).maybeSingle();
        if (existing?.slug) {
          return json({ error: "This template is in use by the dashboard and cannot be deleted. Edit it instead." }, 400);
        }
        const { error } = await adminClient.from("email_templates").delete().eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
    }

    // ─────────────────────── ADMIN / OPS ACTIONS ───────────────────────────
    // An ops manager runs the fulfilment floor, so they get the roster and the
    // assignment actions: see who is on the team, see anyone's clients, and
    // move a client between members.
    //
    // What they deliberately do NOT get is anything that creates access:
    // set_team_member (is_team) and set_team_reply_to stay admin-only. The
    // point of the tier is to direct the work without being able to widen who
    // can do it or mint an account - otherwise "ops manager" is just "admin"
    // with a friendlier label, and the distinction stops being worth having.
    const ROSTER_ACTIONS = new Set([
      "list_team", "list_companies", "list_assignments", "get_role_permissions",
      "assign", "unassign", "admin_get_client", "list_team_clients", "list_availability",
    ]);
    if (!isAdmin && !(isTeam && can("assignments_manage") && ROSTER_ACTIONS.has(action || ""))) {
      return json({ error: "Forbidden: admin access required" }, 403);
    }

    if (action === "list_users") {
      const { data } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const ids = (data?.users || []).map((u: { id: string }) => u.id);
      const { data: profiles } = await adminClient
        .from("profiles").select("id, full_name, role, is_team, is_admin").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const pmap = Object.fromEntries((profiles || []).map((p: Record<string, unknown>) => [p.id, p]));
      const users = (data?.users || []).map((u: { id: string; email?: string }) => {
        const p = (pmap[u.id] || {}) as Record<string, unknown>;
        return { id: u.id, email: u.email || "", full_name: p.full_name || null, role: p.role || null, is_team: p.is_team === true, is_admin: p.is_admin === true };
      });
      return json({ users });
    }

    if (action === "list_team") {
      const { data: team } = await adminClient.from("profiles").select("id, full_name, team_reply_to_email, team_role").eq("is_team", true);
      const ids = (team || []).map((v: { id: string }) => v.id);
      const emails = await emailMap(adminClient, ids);
      const { data: assigns } = await adminClient.from("team_assignments").select("team_user_id, company_id").in("team_user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const counts: Record<string, number> = {};
      for (const a of assigns || []) counts[a.team_user_id as string] = (counts[a.team_user_id as string] || 0) + 1;
      const list = (team || []).map((v: Record<string, unknown>) => ({
        id: v.id, full_name: v.full_name, email: emails[v.id as string] || "",
        team_reply_to_email: v.team_reply_to_email || null,
        team_role: (v.team_role as string) || "member",
        assigned: counts[v.id as string] || 0,
      }));
      // Both keys, same array: `team` is the name to use, `vas` keeps a cached
      // page working through the rollout.
      // Both keys, same array: `team` is canonical, `vas` keeps a cached page
      // working through the rollout.
      return json({ team: list, vas: list });
    }

    if (action === "set_team_member") {
      const b = body as { user_id?: string; is_team?: boolean; team_role?: string };
      const user_id = b.user_id;
      if (!user_id) return json({ error: "user_id is required" }, 400);
      // is_team is the canonical key. A page cached from before the rename
      // still sends is_va, so that is read as a fallback rather than ignored -
      // silently treating a missing key as false would have quietly removed
      // someone from the team instead of adding them.
      const legacyFlag = (body as { is_va?: boolean }).is_va;
      const onTeam = (b.is_team ?? legacyFlag) === true;

      const upd: Record<string, unknown> = { is_team: onTeam };
      if (b.team_role !== undefined) {
        if (!["member", "ops_manager"].includes(b.team_role)) {
          return json({ error: "team_role must be 'member' or 'ops_manager'" }, 400);
        }
        upd.team_role = b.team_role;
      }
      // Coming off the team takes the tier with it, so a re-added member does
      // not silently come back as an ops manager.
      if (!onTeam) upd.team_role = "member";

      const { error } = await adminClient.from("profiles").update(upd).eq("id", user_id);
      if (error) return json({ error: error.message }, 500);
      // Tidy up assignments if demoting.
      if (!onTeam) await adminClient.from("team_assignments").delete().eq("team_user_id", user_id);

      // Who may act on clients is worth a log line even though it names no
      // single client - this is the one entry with a null company_id.
      await logAction({
        company_id: null,
        action: onTeam ? "team.member_added" : "team.member_removed",
        detail: { user_id, team_role: upd.team_role ?? null },
      });
      return json({ ok: true });
    }

    // ── The permissions matrix, edited in /admin ─────────────────────────
    if (action === "get_role_permissions") {
      const { data, error } = await adminClient
        .from("team_role_permissions").select("*").order("role");
      if (error) return json({ error: error.message }, 500);
      return json({ roles: data || [], capabilities: CAPS });
    }

    if (action === "set_role_permissions") {
      // Admin only: an ops manager can direct the work but must not be able to
      // grant themselves or anyone else more of it.
      if (!isAdmin) return json({ error: "Only an admin can change permissions" }, 403);
      const b = body as { role?: string; permissions?: Record<string, unknown> };
      if (!b.role || !["csm", "ops_manager", "media_buyer", "tech_lead"].includes(b.role)) {
        return json({ error: "Unknown role" }, 400);
      }
      const upd: Record<string, unknown> = {
        role: b.role, updated_at: new Date().toISOString(), updated_by: caller.id,
      };
      for (const c of CAPS) {
        if (b.permissions && c in b.permissions) upd[c] = b.permissions[c] === true;
      }
      const { error } = await adminClient
        .from("team_role_permissions").upsert(upd, { onConflict: "role" });
      if (error) return json({ error: error.message }, 500);
      await logAction({
        company_id: null, action: "permissions.changed",
        detail: { role: b.role, permissions: b.permissions ?? {} },
      });
      return json({ ok: true });
    }

    if (action === "list_companies") {
      const { data } = await adminClient.from("companies").select("id, name, plan").order("name", { ascending: true });
      return json({ companies: data || [] });
    }

    if (action === "list_assignments") {
      const { team_user_id } = body as { team_user_id?: string };
      if (!team_user_id) return json({ error: "team_user_id is required" }, 400);
      const { data: assigns } = await adminClient.from("team_assignments").select("company_id").eq("team_user_id", team_user_id);
      const ids = (assigns || []).map((a: { company_id: string }) => a.company_id);
      if (!ids.length) return json({ companies: [] });
      const { data } = await adminClient.from("companies").select("id, name, plan").in("id", ids).order("name", { ascending: true });
      return json({ companies: data || [] });
    }

    if (action === "assign") {
      const { team_user_id, company_id } = body as { team_user_id?: string; company_id?: string };
      if (!team_user_id || !company_id) return json({ error: "team_user_id and company_id are required" }, 400);
      // Only allow assigning companies to someone actually on the team.
      const { data: target } = await adminClient.from("profiles").select("is_team, full_name").eq("id", team_user_id).maybeSingle();
      if (!target?.is_team) return json({ error: "Target user is not on the Internal Team" }, 400);
      const targetEmail = (await emailMap(adminClient, [team_user_id]))[team_user_id] || "";
      // Was this already theirs? Re-running the assignment should not re-notify.
      const { data: existing } = await adminClient.from("team_assignments")
        .select("id").eq("team_user_id", team_user_id).eq("company_id", company_id).maybeSingle();
      const { error } = await adminClient.from("team_assignments").upsert({ team_user_id, company_id }, { onConflict: "team_user_id,company_id" });
      if (error) return json({ error: error.message }, 500);

      // Tell the team member they have a new client. Best effort: the assignment itself
      // has already succeeded, and a bounced notification must not undo it.
      let notified = false;
      if (!existing && targetEmail) {
        const { data: company } = await adminClient
          .from("companies").select("name, plan, niche, service_area").eq("id", company_id).maybeSingle();
        const vaFirst = String(target.full_name || "").trim().split(/\s+/)[0] || "there";
        const lines = [
          `Hi ${vaFirst},`,
          "",
          `${company?.name || "A new client"} has been assigned to you.`,
          "",
          "Two things to do, in this order:",
          "",
          "  1. Log in to your dashboard and check the scope is right - plan, niche and service area. If anything looks wrong, flag it before you contact them.",
          "  2. Send them the onboarding email from the client's page. The draft is ready, edit it if you want, and it goes out with your address on the reply.",
          "",
          "Details on file:",
          `  Plan: ${company?.plan || "-"}`,
          `  Niche: ${company?.niche || "-"}`,
          `  Service area: ${company?.service_area || "-"}`,
          "",
          "https://quoteleadshq.com/team-panel",
          "",
          "QuoteLeads",
        ].join("\n");
        const res = await sendEmail({
          to: targetEmail,
          subject: `New client assigned - ${company?.name || "action needed"}`,
          text: lines,
          fromName: "QuoteLeads",
        });
        notified = res.ok;
        if (!res.ok) console.warn("Internal Team assignment notification failed:", res.error);
      }
      await logAction({
        company_id,
        action: "client.assigned",
        detail: { to_user_id: team_user_id, to_name: target.full_name || null, notified, already_theirs: !!existing },
      });
      return json({ ok: true, notified });
    }

    if (action === "set_team_reply_to") {
      const { team_user_id } = body as { team_user_id?: string };
      const replyTo = String((body as { reply_to_email?: string }).reply_to_email ?? "").trim().toLowerCase();
      if (!team_user_id) return json({ error: "team_user_id is required" }, 400);
      if (replyTo && !EMAIL_RE.test(replyTo)) return json({ error: "Enter a valid reply-to email" }, 400);
      const { error } = await adminClient.from("profiles")
        .update({ team_reply_to_email: replyTo || null }).eq("id", team_user_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "unassign") {
      const { team_user_id, company_id } = body as { team_user_id?: string; company_id?: string };
      if (!team_user_id || !company_id) return json({ error: "team_user_id and company_id are required" }, 400);
      const { error } = await adminClient.from("team_assignments").delete().eq("team_user_id", team_user_id).eq("company_id", company_id);
      if (error) return json({ error: error.message }, 500);
      await logAction({ company_id, action: "client.unassigned", detail: { from_user_id: team_user_id } });
      return json({ ok: true });
    }

    if (action === "admin_get_client") {
      const companyId = (body as { company_id?: string }).company_id;
      if (!companyId) return json({ error: "company_id is required" }, 400);
      const { data: company } = await adminClient
        .from("companies")
        .select("id, name, plan, email, phone, domain, created_at")
        .eq("id", companyId)
        .maybeSingle();
      if (!company) return json({ error: "Client not found" }, 404);
      const { data: members } = await adminClient
        .from("profiles")
        .select("id, full_name, phone, role")
        .eq("company_id", companyId);
      const emails2 = await emailMap(adminClient, (members || []).map((m: { id: string }) => m.id));
      const contacts = (members || []).map((m: Record<string, unknown>) => ({
        full_name: m.full_name, phone: m.phone, role: m.role, email: emails2[m.id as string] || "",
      }));
      const { data: leadOrders } = await adminClient
        .from("ppl_lead_orders")
        .select("id, niche, area, quantity, delivered_count, price_per_lead, total_amount, status, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      const { data: orders } = await adminClient
        .from("ppl_orders")
        .select("id, total_leads, delivered_leads, status, due_date, notes, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      const { data: clientNotes } = await adminClient
        .from("client_notes")
        .select("id, body, author_name, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return json({ company, contacts, lead_orders: leadOrders || [], orders: orders || [], notes: clientNotes || [] });
    }

    if (action === "list_team_clients") {
      const vaUserId = (body as { team_user_id?: string }).team_user_id;
      if (!vaUserId) return json({ error: "team_user_id is required" }, 400);
      const { data: assigns } = await adminClient
        .from("team_assignments").select("company_id").eq("team_user_id", vaUserId);
      const ids = (assigns || []).map((a: { company_id: string }) => a.company_id);
      if (!ids.length) return json({ clients: [] });
      const { data: companies } = await adminClient
        .from("companies").select("id, name, plan, email, phone").in("id", ids).order("name", { ascending: true });
      const { data: pplOrders } = await adminClient
        .from("ppl_orders").select("company_id, total_leads, delivered_leads, status").in("company_id", ids);
      const { data: notes } = await adminClient
        .from("client_notes").select("company_id").in("company_id", ids);
      const { data: leadRows } = await adminClient
        .from("leads").select("company_id").in("company_id", ids);
      const agg: Record<string, { totalLeads: number; delivered: number; activeOrders: number; notes: number; accountLeads: number }> = {};
      for (const id of ids) agg[id] = { totalLeads: 0, delivered: 0, activeOrders: 0, notes: 0, accountLeads: 0 };
      for (const o of pplOrders || []) {
        const a = agg[o.company_id as string]; if (!a) continue;
        a.totalLeads += (o.total_leads as number) || 0;
        a.delivered += (o.delivered_leads as number) || 0;
        if (o.status === "active") a.activeOrders += 1;
      }
      for (const n of notes || []) { const a = agg[n.company_id as string]; if (a) a.notes += 1; }
      for (const l of leadRows || []) { const a = agg[l.company_id as string]; if (a) a.accountLeads += 1; }
      const clients = (companies || []).map((c: Record<string, unknown>) => ({
        id: c.id, name: c.name, plan: c.plan, email: c.email, phone: c.phone, ...agg[c.id as string],
      }));
      // The previewed member's own capabilities travel with their client list,
      // so the admin preview renders THEIR panel. Without this the page fell
      // back to the caller's, and an admin previewing a CSM saw controls the CSM
      // does not have - a preview that cannot be trusted is worse than none.
      const { data: target } = await adminClient
        .from("profiles").select("full_name, team_role, is_admin").eq("id", vaUserId).maybeSingle();
      const targetPerms = target?.is_admin
        ? Object.fromEntries(CAPS.map((c) => [c, true])) as Record<Cap, boolean>
        : await permsForRole(target?.team_role as string);
      return json({
        clients,
        me: {
          team_role: target?.is_admin ? "admin" : ((target?.team_role as string) || "csm"),
          is_ops: target?.team_role === "ops_manager",
          is_admin: target?.is_admin === true,
          unrestricted: target?.is_admin === true || targetPerms.all_clients === true,
          full_name: target?.full_name || null,
          can: targetPerms,
        },
      });
    }

    if (action === "list_availability") {
      const { data: team } = await adminClient.from("profiles").select("id, full_name").eq("is_team", true);
      const ids = (team || []).map((v: { id: string }) => v.id);
      const emails = await emailMap(adminClient, ids);
      const { data: avail } = await adminClient
        .from("team_availability").select("team_user_id, slots")
        .in("team_user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const amap: Record<string, unknown> = {};
      for (const a of avail || []) amap[a.team_user_id as string] = a.slots;
      const list = (team || []).map((v: Record<string, unknown>) => ({
        id: v.id, full_name: v.full_name, email: emails[v.id as string] || "", slots: amap[v.id as string] || [],
      }));
      return json({ availability: list });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("team-api error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
