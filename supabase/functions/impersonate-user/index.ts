import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS headers ──────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Verify caller JWT and resolve their auth.users record ─────────────────────
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

Deno.serve(async (req) => {
  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth header required ──────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    // ── Build two Supabase clients ────────────────────────────────────────────
    // userClient: runs as the calling user — used only for JWT validation.
    // adminClient: uses the service role key — NEVER returned to the client.
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

    // ── Verify caller JWT ─────────────────────────────────────────────────────
    const caller = await resolveCallerUser(authHeader, userClient);
    if (!caller) {
      return json({ error: "Not authenticated" }, 401);
    }

    // ── Check is_admin flag ───────────────────────────────────────────────────
    // We query via the adminClient to bypass RLS and avoid any possibility of
    // a user manipulating the result through a crafted JWT or RLS policy.
    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("is_admin")
      .eq("id", caller.id)
      .maybeSingle();

    if (profileError) {
      console.error("Profile lookup error:", profileError.message);
      return json({ error: "Internal error checking admin status" }, 500);
    }

    if (!callerProfile?.is_admin) {
      return json({ error: "Forbidden: admin access required" }, 403);
    }

    // ── Route on action ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { action } = body as { action?: string };

    // ── action: list ──────────────────────────────────────────────────────────
    // Returns a condensed list of all auth users (email + profile metadata).
    // The service role key stays server-side; only safe fields are returned.
    if (action === "list") {
      const users: Array<{
        id: string;
        email: string;
        full_name: string | null;
        company_id: string | null;
        role: string | null;
        is_admin: boolean;
        created_at: string;
      }> = [];

      let page = 1;
      while (true) {
        const { data: pageData, error: listError } =
          await adminClient.auth.admin.listUsers({ page, perPage: 1000 });

        if (listError) {
          console.error("listUsers error:", listError.message);
          return json({ error: "Failed to list users" }, 500);
        }

        if (!pageData?.users?.length) break;

        // Batch-fetch matching profiles for this page of users
        const ids = pageData.users.map((u: { id: string }) => u.id);
        const { data: profiles } = await adminClient
          .from("profiles")
          .select("id, full_name, company_id, role, is_admin")
          .in("id", ids);

        const profileMap = Object.fromEntries(
          (profiles || []).map((p: {
            id: string;
            full_name: string | null;
            company_id: string | null;
            role: string | null;
            is_admin: boolean;
          }) => [p.id, p]),
        );

        for (const u of pageData.users) {
          const p = profileMap[u.id] || null;
          users.push({
            id: u.id,
            email: u.email ?? "",
            full_name: p?.full_name ?? null,
            company_id: p?.company_id ?? null,
            role: p?.role ?? null,
            is_admin: p?.is_admin ?? false,
            created_at: u.created_at ?? "",
          });
        }

        if (pageData.users.length < 1000) break;
        page++;
      }

      return json({ users });
    }

    // ── action: login ─────────────────────────────────────────────────────────
    // Generates a magic-link token for the target user, immediately exchanges
    // it for a session server-side via verifyOtp, and returns the session.
    // No email is ever sent to the target user.
    if (action === "login") {
      const { email } = body as { email?: string };
      if (!email || typeof email !== "string") {
        return json({ error: "Missing or invalid email" }, 400);
      }

      // Sanitise email
      const targetEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
        return json({ error: "Invalid email address" }, 400);
      }

      // Step 1: generate a magic-link — does NOT send any email.
      const { data: linkData, error: linkError } =
        await adminClient.auth.admin.generateLink({
          type: "magiclink",
          email: targetEmail,
        });

      if (linkError || !linkData?.properties?.hashed_token) {
        console.error(
          "generateLink error:",
          linkError?.message || "no hashed_token",
        );
        return json({ error: "Failed to generate impersonation token" }, 500);
      }

      const hashedToken = linkData.properties.hashed_token;

      // Step 2: exchange the hashed_token for a live session — still
      // server-side, never leaves this function until it is a session object.
      const { data: otpData, error: otpError } =
        await adminClient.auth.verifyOtp({
          token_hash: hashedToken,
          type: "email",
        });

      if (otpError || !otpData?.session) {
        console.error(
          "verifyOtp error:",
          otpError?.message || "no session returned",
        );
        return json({ error: "Failed to create impersonation session" }, 500);
      }

      // Return only the session — service role key is never included.
      return json({ session: otpData.session });
    }

    // ── action: list_disputes ─────────────────────────────────────────────────
    // Returns all lead disputes across every company (admin view).
    // All reads happen via the service-role client — RLS is bypassed server-side
    // and no sensitive keys are ever returned to the browser.
    if (action === "list_disputes") {
      const { data: disputes, error: disputeErr } = await adminClient
        .from("lead_disputes")
        .select(`
          id,
          reason,
          status,
          auto_check_result,
          manual_review_notes,
          scrub_cap_pct,
          scrub_used_pct,
          resolution_notes,
          resolved_at,
          created_at,
          updated_at,
          lead_id,
          company_id,
          raised_by,
          resolved_by
        `)
        .order("created_at", { ascending: false })
        .limit(500);

      if (disputeErr) {
        console.error("list_disputes error:", disputeErr.message);
        return json({ error: "Failed to load disputes" }, 500);
      }

      if (!disputes?.length) return json({ disputes: [] });

      // Batch-fetch related records to avoid N+1 queries
      const leadIds     = [...new Set(disputes.map((d: { lead_id: string }) => d.lead_id))];
      const companyIds  = [...new Set(disputes.map((d: { company_id: string }) => d.company_id))];
      const userIds     = [...new Set([
        ...disputes.map((d: { raised_by: string | null }) => d.raised_by).filter(Boolean),
        ...disputes.map((d: { resolved_by: string | null }) => d.resolved_by).filter(Boolean),
      ])] as string[];

      const [{ data: leads }, { data: companies }, { data: profiles }] = await Promise.all([
        adminClient.from("leads").select("id, first_name, last_name, phone, postcode, email").in("id", leadIds),
        adminClient.from("companies").select("id, name").in("id", companyIds),
        adminClient.from("profiles").select("id, full_name").in("id", userIds),
      ]);

      const leadMap    = Object.fromEntries((leads    || []).map((r: { id: string }) => [r.id, r]));
      const companyMap = Object.fromEntries((companies|| []).map((r: { id: string }) => [r.id, r]));
      const profileMap = Object.fromEntries((profiles || []).map((r: { id: string }) => [r.id, r]));

      const enriched = disputes.map((d: {
        id: string; reason: string; status: string; auto_check_result: unknown;
        manual_review_notes: string | null; scrub_cap_pct: number | null;
        scrub_used_pct: number | null; resolution_notes: string | null;
        resolved_at: string | null; created_at: string; updated_at: string;
        lead_id: string; company_id: string; raised_by: string | null; resolved_by: string | null;
      }) => ({
        ...d,
        lead:          leadMap[d.lead_id]    ?? null,
        company:       companyMap[d.company_id] ?? null,
        raised_by_profile:   profileMap[d.raised_by ?? ""] ?? null,
        resolved_by_profile: profileMap[d.resolved_by ?? ""] ?? null,
      }));

      return json({ disputes: enriched });
    }

    // ── action: resolve_dispute ───────────────────────────────────────────────
    // Allows an admin to manually approve or reject a dispute.
    if (action === "resolve_dispute") {
      const { dispute_id, resolution, notes } = body as {
        dispute_id?: string;
        resolution?: string;
        notes?: string;
      };

      if (!dispute_id || typeof dispute_id !== "string") {
        return json({ error: "dispute_id is required" }, 400);
      }
      if (!resolution || !["manual_approved", "manual_rejected"].includes(resolution)) {
        return json({ error: "resolution must be 'manual_approved' or 'manual_rejected'" }, 400);
      }

      // Fetch dispute to confirm it exists and is in a resolvable state
      const { data: dispute, error: fetchErr } = await adminClient
        .from("lead_disputes")
        .select("id, status")
        .eq("id", dispute_id)
        .maybeSingle();

      if (fetchErr || !dispute) {
        return json({ error: "Dispute not found" }, 404);
      }

      const resolvableStatuses = ["pending", "auto_approved", "auto_rejected", "pending_manual_review"];
      if (!resolvableStatuses.includes(dispute.status)) {
        return json({ error: `Dispute is already resolved (status: ${dispute.status})` }, 409);
      }

      const { error: updateErr } = await adminClient
        .from("lead_disputes")
        .update({
          status:           resolution,
          resolved_at:      new Date().toISOString(),
          resolved_by:      caller.id,
          resolution_notes: notes?.trim() || null,
        })
        .eq("id", dispute_id);

      if (updateErr) {
        console.error("resolve_dispute update error:", updateErr.message);
        return json({ error: "Failed to resolve dispute" }, 500);
      }

      return json({ dispute_id, status: resolution });
    }

    // ── Unknown action ────────────────────────────────────────────────────────
    return json({ error: `Unknown action: ${action ?? "(none)"}` }, 400);
  } catch (err) {
    console.error("impersonate-user unhandled error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
