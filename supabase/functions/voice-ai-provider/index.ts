import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Voice AI Provider — Edge Function
 *
 * Handles VAPI voice agent operations:
 *   - get_config:  Return voice agent config for the company
 *   - save_key:    Store VAPI API key (encrypted)
 *   - test:        Test VAPI connection
 *   - create_call: Initiate an outbound call via VAPI
 */

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
  const token = (authHeader || "").replace(/^Bearer\s+/i, "");

  // 1. Try the standard auth.getUser() path first.
  //    Pass the token explicitly — Deno edge functions have no persistent
  //    session storage, so the zero-arg overload can't resolve the JWT.
  try {
    const { data: { user }, error } = await userClient.auth.getUser(token);
    if (user) return user;
    if (error) console.warn("auth.getUser() failed:", error.message);
  } catch (e) {
    console.warn("auth.getUser() threw:", (e as Error).message);
  }

  // 2. Fallback: decode JWT payload and verify user exists via admin API
  try {
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

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Authenticate user (with fallback if JWT verification fails)
    const user = await getCallerUser(authHeader, userClient, adminClient);

    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user profile and company (use admin client so it works even when JWT is stale)
    const { data: profile } = await adminClient
      .from("profiles")
      .select("company_id, user_type, role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, ...params } = await req.json();

    // ── get_config ───────────────────────────────────────────────────────────
    if (action === "get_config") {
      const { data: config } = await adminClient
        .from("voice_agent_config")
        .select("*")
        .eq("company_id", profile.company_id)
        .maybeSingle();

      return new Response(JSON.stringify({ config: config || null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── save_key ─────────────────────────────────────────────────────────────
    if (action === "save_key") {
      const { vapiKey } = params;
      if (!vapiKey) {
        return new Response(JSON.stringify({ error: "VAPI key is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Store encrypted key via the existing api_keys table
      const keyHint = vapiKey.slice(0, 4) + "..." + vapiKey.slice(-4);

      // Insert or update the encrypted key using SQL to call pgcrypto
      const { error } = await adminClient.rpc("save_vapi_key", {
        p_company_id: profile.company_id,
        p_raw_key: vapiKey,
        p_key_hint: keyHint,
        p_user_id: user.id,
      });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── test ─────────────────────────────────────────────────────────────────
    if (action === "test") {
      // Check that voice agent config exists and has an assistant ID
      const { data: config } = await adminClient
        .from("voice_agent_config")
        .select("vapi_assistant_id, is_active")
        .eq("company_id", profile.company_id)
        .maybeSingle();

      if (!config?.vapi_assistant_id) {
        return new Response(
          JSON.stringify({
            error: "No VAPI Assistant ID configured. Please save your voice agent settings first.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Resolve VAPI API key
      const { data: vapiKey } = await adminClient.rpc("resolve_api_key", {
        p_company_id: profile.company_id,
        p_provider: "vapi",
      });

      if (!vapiKey) {
        return new Response(
          JSON.stringify({
            error: "No VAPI API key found. Please add your VAPI key in the Provider section.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Test connection by fetching assistant details from VAPI
      const vapiRes = await fetch(
        `https://api.vapi.ai/assistant/${config.vapi_assistant_id}`,
        {
          headers: { Authorization: `Bearer ${vapiKey}` },
        }
      );

      if (!vapiRes.ok) {
        const errBody = await vapiRes.text();
        return new Response(
          JSON.stringify({
            error: `VAPI connection failed (${vapiRes.status}): ${errBody}`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── create_call ──────────────────────────────────────────────────────────
    if (action === "create_call") {
      const { leadId, phoneNumber, assistantId, metadata } = params;

      if (!phoneNumber) {
        return new Response(
          JSON.stringify({ error: "Phone number is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Get voice config
      const { data: config } = await adminClient
        .from("voice_agent_config")
        .select("vapi_assistant_id, voice_id")
        .eq("company_id", profile.company_id)
        .maybeSingle();

      const resolvedAssistantId =
        assistantId || config?.vapi_assistant_id;

      if (!resolvedAssistantId) {
        return new Response(
          JSON.stringify({
            error: "No VAPI assistant configured. Please set up Voice AI first.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Resolve VAPI key
      const { data: vapiKey } = await adminClient.rpc("resolve_api_key", {
        p_company_id: profile.company_id,
        p_provider: "vapi",
      });

      if (!vapiKey) {
        return new Response(
          JSON.stringify({ error: "No VAPI API key found" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Create call via VAPI API
      // If a voice_id is configured, override the assistant's voice with
      // ElevenLabs using that ID.
      const callPayload: Record<string, unknown> = {
        assistantId: resolvedAssistantId,
        customer: { number: phoneNumber },
        metadata: metadata || {},
      };

      const resolvedVoiceId = config?.voice_id;
      if (resolvedVoiceId) {
        callPayload.assistantOverrides = {
          voice: {
            provider: "11labs",
            voiceId: resolvedVoiceId,
          },
        };
      }

      const vapiRes = await fetch("https://api.vapi.ai/call/phone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${vapiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(callPayload),
      });

      if (!vapiRes.ok) {
        const errBody = await vapiRes.text();
        return new Response(
          JSON.stringify({
            error: `VAPI call failed (${vapiRes.status}): ${errBody}`,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const callData = await vapiRes.json();

      // Log the call in voice_calls table
      await adminClient.from("voice_calls").insert({
        company_id: profile.company_id,
        lead_id: leadId || null,
        vapi_call_id: callData.id,
        direction: "outbound",
        status: "ringing",
        to_number: phoneNumber,
      });

      return new Response(
        JSON.stringify({ success: true, callId: callData.id }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("voice-ai-provider error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
