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

    // ── Unknown action ────────────────────────────────────────────────────────
    return json({ error: `Unknown action: ${action ?? "(none)"}` }, 400);
  } catch (err) {
    console.error("impersonate-user unhandled error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
