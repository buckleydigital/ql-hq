// =============================================================================
// va-api - Virtual Assistant API
// =============================================================================
// One edge function powering two callers, both verified server-side via the
// service role (never trusting the client):
//
//   VA actions    (caller must have profiles.is_va = true)
//     • list_clients      → the companies assigned to this VA (+ lead summary)
//     • get_client        → full read-only picture of ONE assigned company
//     • add_note          → add an internal note to an assigned company
//
//   Admin actions (caller must have profiles.is_admin = true)
//     • list_users        → all users (to pick who becomes a VA)
//     • list_vas          → current VAs + their assignment counts
//     • set_va            → flip a user's is_va flag
//     • list_companies    → all companies (for the assignment picker)
//     • assign / unassign → manage a VA's company assignments
//     • list_assignments  → companies assigned to a given VA
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
      .select("is_va, is_admin, full_name")
      .eq("id", caller.id)
      .maybeSingle();
    if (meErr) {
      console.error("caller profile lookup failed:", meErr.message);
      return json({ error: "Internal error" }, 500);
    }
    const isVa = me?.is_va === true;
    const isAdmin = me?.is_admin === true;

    const body = await req.json().catch(() => ({}));
    const { action } = body as { action?: string };

    // ───────────────────────────── VA ACTIONS ──────────────────────────────
    const VA_ACTIONS = new Set(["list_clients", "get_client", "add_note", "get_availability", "set_availability"]);
    if (VA_ACTIONS.has(action || "")) {
      if (!isVa) return json({ error: "Forbidden: VA access required" }, 403);

      // ── Weekly call availability (no client assignment needed) ──────────────
      if (action === "get_availability") {
        const { data: av } = await adminClient
          .from("va_availability").select("slots").eq("va_user_id", caller.id).maybeSingle();
        return json({ slots: av?.slots || [] });
      }
      if (action === "set_availability") {
        const raw = (body as { slots?: unknown }).slots;
        const slots = Array.isArray(raw)
          ? raw.filter((s): s is string => typeof s === "string" && /^(mon|tue|wed|thu|fri|sat|sun)-\d{1,2}$/.test(s)).slice(0, 200)
          : [];
        const { error } = await adminClient
          .from("va_availability")
          .upsert({ va_user_id: caller.id, slots, updated_at: new Date().toISOString() }, { onConflict: "va_user_id" });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, slots });
      }

      // The exact set of companies this VA is allowed to see.
      const { data: assigns } = await adminClient
        .from("va_assignments")
        .select("company_id")
        .eq("va_user_id", caller.id);
      const allowedIds = new Set((assigns || []).map((a: { company_id: string }) => a.company_id));

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
        return json({ clients });
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
          .insert({ company_id: companyId, author_id: caller.id, author_name: me?.full_name || "VA", body: noteBody.slice(0, 5000) })
          .select("id, body, author_name, created_at")
          .single();
        if (error) return json({ error: error.message }, 500);
        return json({ note });
      }
    }

    // ═══════════════════════════ BILLING / INVOICING ═══════════════════════
    // Shared by /admin (full control) and, later, /va (create + read only).
    // Access split:
    //   • Admin  → everything below.
    //   • VA     → billing_list (assigned only), create_invoice, list_invoices,
    //              get_bank_details (READ-ONLY). Never set_bank_details, never
    //              billing_update_company, never delete_invoice.
    const VA_BILLING_ACTIONS = new Set(["billing_list", "list_invoices", "create_invoice", "get_bank_details"]);
    const isBillingAction = [
      "billing_list", "billing_update_company", "list_invoices", "create_invoice",
      "update_invoice", "delete_invoice", "get_bank_details", "set_bank_details",
    ].includes(action || "");

    if (isBillingAction) {
      if (!isAdmin && !(isVa && VA_BILLING_ACTIONS.has(action || ""))) {
        return json({ error: "Forbidden" }, 403);
      }

      // For VAs, restrict every company reference to their assignments.
      let vaAllowed: Set<string> | null = null;
      if (!isAdmin) {
        const { data: assigns } = await adminClient
          .from("va_assignments").select("company_id").eq("va_user_id", caller.id);
        vaAllowed = new Set((assigns || []).map((a: { company_id: string }) => a.company_id));
      }

      // ── List all clients with their billing state + delivery + invoices ──
      if (action === "billing_list") {
        let q = adminClient
          .from("companies")
          .select("id, name, email, phone, plan, created_at, payment_method, ads_live_date, next_invoice_due, invoice_status, va_intro_done, va_intro_done_at");
        if (vaAllowed) {
          const ids = [...vaAllowed];
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

      // ── Update a company's billing / onboarding fields (admin only) ──────
      if (action === "billing_update_company") {
        const { company_id, fields } = body as { company_id?: string; fields?: Record<string, unknown> };
        if (!company_id) return json({ error: "company_id is required" }, 400);
        const f = fields || {};
        const upd: Record<string, unknown> = {};
        const allowed = ["payment_method", "ads_live_date", "next_invoice_due", "invoice_status", "va_intro_done"];
        for (const k of allowed) if (k in f) upd[k] = f[k] === "" ? null : f[k];
        if ("payment_method" in upd && upd.payment_method != null && !["invoice", "stripe"].includes(upd.payment_method as string)) {
          return json({ error: "payment_method must be 'invoice' or 'stripe'" }, 400);
        }
        if ("invoice_status" in upd && upd.invoice_status != null && !["none", "due", "sent", "paid", "unpaid"].includes(upd.invoice_status as string)) {
          return json({ error: "invalid invoice_status" }, 400);
        }
        if ("va_intro_done" in upd) upd.va_intro_done_at = upd.va_intro_done ? new Date().toISOString() : null;
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
          if (vaAllowed && !vaAllowed.has(companyId)) return json({ error: "Forbidden" }, 403);
          q = q.eq("company_id", companyId);
        } else if (vaAllowed) {
          const ids = [...vaAllowed];
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
        if (vaAllowed && (!companyId || !vaAllowed.has(companyId))) {
          return json({ error: "Forbidden: client not assigned to you" }, 403);
        }
        const row = sanitizeInvoice(inv);
        row.created_by = caller.id;
        const { data, error } = await adminClient.from("invoices").insert(row).select("*").single();
        if (error) return json({ error: error.message }, 500);
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
        return json({ invoice: data });
      }

      // ── Delete an invoice (admin only) ───────────────────────────────────
      if (action === "delete_invoice") {
        const id = (body as { id?: string }).id;
        if (!id) return json({ error: "id is required" }, 400);
        const { error } = await adminClient.from("invoices").delete().eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ── Bank / business settings ─────────────────────────────────────────
      if (action === "get_bank_details") {
        const { data } = await adminClient.from("business_settings").select("*").eq("id", 1).maybeSingle();
        return json({ settings: data || {}, can_edit: isAdmin });
      }
      if (action === "set_bank_details") {
        // Admin only - VAs never reach here (guarded above).
        const s = (body as { settings?: Record<string, unknown> }).settings || {};
        const allowed = ["business_name", "abn", "bank_name", "account_name", "bsb", "account_number", "payment_details", "logo_url"];
        const upd: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
        for (const k of allowed) if (k in s) upd[k] = s[k];
        const { error } = await adminClient.from("business_settings").upsert(upd, { onConflict: "id" });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
    }

    // ─────────────────────────── ADMIN ACTIONS ─────────────────────────────
    if (!isAdmin) return json({ error: "Forbidden: admin access required" }, 403);

    if (action === "list_users") {
      const { data } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const ids = (data?.users || []).map((u: { id: string }) => u.id);
      const { data: profiles } = await adminClient
        .from("profiles").select("id, full_name, role, is_va, is_admin").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const pmap = Object.fromEntries((profiles || []).map((p: Record<string, unknown>) => [p.id, p]));
      const users = (data?.users || []).map((u: { id: string; email?: string }) => {
        const p = (pmap[u.id] || {}) as Record<string, unknown>;
        return { id: u.id, email: u.email || "", full_name: p.full_name || null, role: p.role || null, is_va: p.is_va === true, is_admin: p.is_admin === true };
      });
      return json({ users });
    }

    if (action === "list_vas") {
      const { data: vas } = await adminClient.from("profiles").select("id, full_name").eq("is_va", true);
      const ids = (vas || []).map((v: { id: string }) => v.id);
      const emails = await emailMap(adminClient, ids);
      const { data: assigns } = await adminClient.from("va_assignments").select("va_user_id, company_id").in("va_user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const counts: Record<string, number> = {};
      for (const a of assigns || []) counts[a.va_user_id as string] = (counts[a.va_user_id as string] || 0) + 1;
      const list = (vas || []).map((v: Record<string, unknown>) => ({
        id: v.id, full_name: v.full_name, email: emails[v.id as string] || "", assigned: counts[v.id as string] || 0,
      }));
      return json({ vas: list });
    }

    if (action === "set_va") {
      const { user_id, is_va } = body as { user_id?: string; is_va?: boolean };
      if (!user_id) return json({ error: "user_id is required" }, 400);
      const { error } = await adminClient.from("profiles").update({ is_va: is_va === true }).eq("id", user_id);
      if (error) return json({ error: error.message }, 500);
      // Tidy up assignments if demoting.
      if (is_va !== true) await adminClient.from("va_assignments").delete().eq("va_user_id", user_id);
      return json({ ok: true });
    }

    if (action === "list_companies") {
      const { data } = await adminClient.from("companies").select("id, name, plan").order("name", { ascending: true });
      return json({ companies: data || [] });
    }

    if (action === "list_assignments") {
      const { va_user_id } = body as { va_user_id?: string };
      if (!va_user_id) return json({ error: "va_user_id is required" }, 400);
      const { data: assigns } = await adminClient.from("va_assignments").select("company_id").eq("va_user_id", va_user_id);
      const ids = (assigns || []).map((a: { company_id: string }) => a.company_id);
      if (!ids.length) return json({ companies: [] });
      const { data } = await adminClient.from("companies").select("id, name, plan").in("id", ids).order("name", { ascending: true });
      return json({ companies: data || [] });
    }

    if (action === "assign") {
      const { va_user_id, company_id } = body as { va_user_id?: string; company_id?: string };
      if (!va_user_id || !company_id) return json({ error: "va_user_id and company_id are required" }, 400);
      // Only allow assigning companies to an actual VA.
      const { data: target } = await adminClient.from("profiles").select("is_va").eq("id", va_user_id).maybeSingle();
      if (!target?.is_va) return json({ error: "Target user is not a VA" }, 400);
      const { error } = await adminClient.from("va_assignments").upsert({ va_user_id, company_id }, { onConflict: "va_user_id,company_id" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "unassign") {
      const { va_user_id, company_id } = body as { va_user_id?: string; company_id?: string };
      if (!va_user_id || !company_id) return json({ error: "va_user_id and company_id are required" }, 400);
      const { error } = await adminClient.from("va_assignments").delete().eq("va_user_id", va_user_id).eq("company_id", company_id);
      if (error) return json({ error: error.message }, 500);
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

    if (action === "admin_list_va_clients") {
      const vaUserId = (body as { va_user_id?: string }).va_user_id;
      if (!vaUserId) return json({ error: "va_user_id is required" }, 400);
      const { data: assigns } = await adminClient
        .from("va_assignments").select("company_id").eq("va_user_id", vaUserId);
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
      return json({ clients });
    }

    if (action === "list_availability") {
      const { data: vas } = await adminClient.from("profiles").select("id, full_name").eq("is_va", true);
      const ids = (vas || []).map((v: { id: string }) => v.id);
      const emails = await emailMap(adminClient, ids);
      const { data: avail } = await adminClient
        .from("va_availability").select("va_user_id, slots")
        .in("va_user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const amap: Record<string, unknown> = {};
      for (const a of avail || []) amap[a.va_user_id as string] = a.slots;
      const list = (vas || []).map((v: Record<string, unknown>) => ({
        id: v.id, full_name: v.full_name, email: emails[v.id as string] || "", slots: amap[v.id as string] || [],
      }));
      return json({ availability: list });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("va-api error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
