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
    // Queried via adminClient to bypass RLS and prevent privilege escalation.
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

    // ── Parse and validate body ───────────────────────────────────────────────
    const body = await req.json().catch(() => ({})) as {
      email?: unknown;
      name?: unknown;
      password?: unknown;
    };

    const { email, name, password } = body;

    if (!email || typeof email !== "string") {
      return json({ error: "email is required" }, 400);
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return json({ error: "name is required" }, 400);
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return json({ error: "password must be at least 8 characters" }, 400);
    }

    const sanitizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizedEmail)) {
      return json({ error: "Invalid email address" }, 400);
    }

    // ── Create the user with a pre-set password ───────────────────────────────
    // email_confirm: true marks the address as verified immediately.
    // No invite, no magic-link, no email of any kind is sent.
    const { data: newUser, error: createError } =
      await adminClient.auth.admin.createUser({
        email: sanitizedEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: name.trim() },
      });

    if (createError || !newUser?.user) {
      console.error("createUser error:", createError?.message);
      return json(
        { error: createError?.message || "Failed to create user" },
        500,
      );
    }

    return json({
      user: {
        id: newUser.user.id,
        email: newUser.user.email,
      },
    });
  } catch (err) {
    console.error("create-user-silent unhandled error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
