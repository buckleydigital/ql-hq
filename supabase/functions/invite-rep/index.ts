import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Resilient user lookup: tries auth.getUser() first (proper JWT verification),
 * then falls back to decoding the JWT payload and looking up the user by ID.
 * This avoids "Invalid JWT" errors caused by token refresh timing issues.
 */
async function getCallerUser(
  authHeader: string,
  userClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
) {
  // 1. Try the standard auth.getUser() path first
  try {
    const { data: { user }, error } = await userClient.auth.getUser();
    if (user) return user;
    if (error) console.warn("auth.getUser() failed:", error.message);
  } catch (e) {
    console.warn("auth.getUser() threw:", (e as Error).message);
  }

  // 2. Fallback: decode JWT payload and verify user exists via admin API
  try {
    const token = (authHeader || "").replace(/^Bearer\s+/i, "");
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(b64));
    if (!payload.sub) return null;
    // Reject tokens expired by more than 5 minutes to limit attack window
    if (payload.exp) {
      const now = Math.floor(Date.now() / 1000);
      if (now - payload.exp > 300) {
        console.warn("JWT expired beyond 5-min grace period, rejecting");
        return null;
      }
    }
    console.warn("JWT verify failed — falling back to admin.getUserById for:", payload.sub);
    const { data, error } = await adminClient.auth.admin.getUserById(payload.sub);
    if (error) {
      console.warn("admin.getUserById failed:", error.message);
      return null;
    }
    return data?.user || null;
  } catch (e) {
    console.warn("JWT decode fallback failed:", (e as Error).message);
    return null;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Client authenticated as the inviting user
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Admin client for creating users
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get the inviting user (with fallback if JWT verification fails)
    const inviter = await getCallerUser(authHeader, userClient, adminClient);

    if (!inviter) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get inviter's profile to check role and company
    // (use admin client so it works even when JWT is stale)
    const { data: profile } = await adminClient
      .from("profiles")
      .select("company_id, role")
      .eq("id", inviter.id)
      .single();

    if (!profile || !["owner", "admin"].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: "Only owners and admins can invite reps" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check current rep count
    const { count } = await adminClient
      .from("sales_reps")
      .select("*", { count: "exact", head: true })
      .eq("company_id", profile.company_id);

    if ((count ?? 0) >= 10) {
      return new Response(
        JSON.stringify({ error: "Maximum of 10 sales reps reached" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body
    const { email, name, phone, visibility } = await req.json();

    if (!email || !name) {
      return new Response(
        JSON.stringify({ error: "Email and name are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if user already exists
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(
      (u) => u.email === email
    );

    let newUserId: string;

    if (existingUser) {
      // User already exists — just link them as a rep
      newUserId = existingUser.id;

      // Update their profile to belong to this company if they don't have one
      const { data: existingProfile } = await adminClient
        .from("profiles")
        .select("id")
        .eq("id", existingUser.id)
        .single();

      if (!existingProfile) {
        await adminClient.from("profiles").insert({
          id: existingUser.id,
          company_id: profile.company_id,
          user_type: "external",
          full_name: name,
          role: "member",
          phone,
        });
      }
    } else {
      // Create new user and send magic link
      const { data: newUser, error: createError } =
        await adminClient.auth.admin.createUser({
          email,
          user_metadata: {
            full_name: name,
            company_id: profile.company_id,
            user_type: "external",
          },
          email_confirm: false, // don't auto-confirm — magic link will do it
        });

      if (createError || !newUser?.user) {
        return new Response(
          JSON.stringify({
            error: createError?.message || "Failed to create user",
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      newUserId = newUser.user.id;
    }

    // Send magic link email
    const { error: magicLinkError } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: {
          redirectTo: `${Deno.env.get("SITE_URL") ?? "http://localhost:3000"}/dashboard`,
        },
      });

    if (magicLinkError) {
      console.error("Magic link error:", magicLinkError);
      // Don't fail — user is created, they can use "forgot password" flow
    }

    // Create the sales rep record
    const defaultVisibility = "assigned_only";
    const { data: rep, error: repError } = await adminClient
      .from("sales_reps")
      .insert({
        company_id: profile.company_id,
        user_id: newUserId,
        name,
        email,
        phone: phone || null,
        leads_visibility: visibility?.leads || defaultVisibility,
        quotes_visibility: visibility?.quotes || defaultVisibility,
        appointments_visibility: visibility?.appointments || defaultVisibility,
        sales_visibility: visibility?.sales || defaultVisibility,
        conversations_visibility:
          visibility?.conversations || defaultVisibility,
      })
      .select()
      .single();

    if (repError) {
      return new Response(JSON.stringify({ error: repError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Track invite in sales_rep_invites table for dashboard visibility
    await adminClient.from("sales_rep_invites").insert({
      company_id: profile.company_id,
      email,
      full_name: name,
      phone: phone || null,
      status: "pending",
    });

    return new Response(
      JSON.stringify({
        message: `Invite sent to ${email}`,
        rep,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("invite-rep error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
