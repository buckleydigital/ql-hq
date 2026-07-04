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
