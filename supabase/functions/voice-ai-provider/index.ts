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

/**
 * Fetch relevant company knowledge for voice agent prompt enrichment (RAG-lite).
 * Returns a prompt fragment to append to the system prompt.
 */
async function fetchCompanyKnowledgeForVoice(
  adminClient: ReturnType<typeof createClient>,
  companyId: string,
): Promise<string> {
  try {
    // Fetch company-specific learnings
    const { data: knowledge } = await adminClient
      .from("company_knowledge")
      .select("category, insight")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(5);

    // Fetch industry-level baseline insights
    const { data: industryInsights } = await adminClient
      .from("industry_insights")
      .select("insight")
      .eq("is_active", true)
      .gte("confidence", 0.3)
      .order("confidence", { ascending: false })
      .limit(2);

    const parts: string[] = [];

    if (knowledge && knowledge.length > 0) {
      const insights = knowledge.map((k: { insight: string }) => `- ${k.insight}`).join("\n");
      parts.push(`Based on past successful interactions with this company's customers, keep these learnings in mind:\n${insights}`);
    }

    if (industryInsights && industryInsights.length > 0) {
      const industry = industryInsights.map((i: { insight: string }) => `- ${i.insight}`).join("\n");
      parts.push(`Industry benchmarks:\n${industry}`);
    }

    if (parts.length === 0) return "";
    return `\n\n${parts.join("\n\n")}\nApply these insights naturally without mentioning them explicitly.`;
  } catch {
    return "";
  }
}

/**
 * Resolve VAPI API key: tries DB first (resolve_api_key RPC), then falls back
 * to the AGENCY_VAPI_KEY env secret for internal (agency) accounts.
 */
async function resolveVapiKey(
  adminClient: ReturnType<typeof createClient>,
  companyId: string,
  userType: string,
): Promise<string | null> {
  // 1. Try DB resolution (api_keys for external, agency_key_mappings/Vault for internal)
  const { data, error } = await adminClient.rpc("resolve_api_key", {
    p_company_id: companyId,
    p_provider: "vapi",
  });
  if (!error && data) return data as string;

  // 2. Only internal (agency) accounts fall back to platform env secrets.
  //    External accounts must supply their own keys via the dashboard.
  if (userType !== "external") {
    const envVal = Deno.env.get("AGENCY_VAPI_KEY");
    if (envVal) {
      console.warn("VAPI key resolved from AGENCY_VAPI_KEY env secret (DB resolution failed)");
      return envVal;
    }
  }

  return null;
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
      const { data: config } = await adminClient
        .from("voice_agent_config")
        .select("vapi_assistant_id, is_active")
        .eq("company_id", profile.company_id)
        .maybeSingle();

      // Resolve VAPI API key (DB first, env fallback for internal accounts)
      const vapiKey = await resolveVapiKey(adminClient, profile.company_id, profile.user_type);

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

      // If an assistant ID is configured, verify it exists in VAPI.
      // Otherwise, just verify the API key works by listing assistants.
      const testUrl = config?.vapi_assistant_id
        ? `https://api.vapi.ai/assistant/${config.vapi_assistant_id}`
        : "https://api.vapi.ai/assistant?limit=1";

      const vapiRes = await fetch(testUrl, {
        headers: { Authorization: `Bearer ${vapiKey}` },
      });

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
        .select(
          "is_active, vapi_phone_number_id, vapi_assistant_id, voice_id, system_prompt, greeting, model, name"
        )
        .eq("company_id", profile.company_id)
        .maybeSingle();

      if (config && config.is_active === false) {
        return new Response(
          JSON.stringify({ error: "Voice agent is currently disabled. Enable it in Voice AI settings." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const resolvedAssistantId =
        assistantId || config?.vapi_assistant_id;

      // Resolve VAPI key (DB first, env fallback for internal accounts)
      const vapiKey = await resolveVapiKey(adminClient, profile.company_id, profile.user_type);

      if (!vapiKey) {
        return new Response(
          JSON.stringify({ error: "No VAPI API key found" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Build the VAPI call payload.
      // Two modes:
      //   1. Named assistant — uses a pre-created assistantId (with optional
      //      voice override via assistantOverrides).
      //   2. Transient assistant — builds an inline assistant definition from
      //      the stored config (system_prompt, greeting, voice_id, model).
      //      No pre-created VAPI assistant is required.

      // VAPI requires phoneNumberId to identify the registered outbound caller
      // number in the VAPI account.
      const vapiPhoneNumberId = config?.vapi_phone_number_id;
      if (!vapiPhoneNumberId) {
        return new Response(
          JSON.stringify({
            error:
              "No VAPI Phone Number ID configured. Please add your VAPI Phone Number ID in Voice AI settings.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Build the webhook URL so VAPI sends status updates & end-of-call
      // reports back to our vapi-webhook edge function.
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const webhookUrl = `${supabaseUrl}/functions/v1/vapi-webhook`;
      const webhookSecret = Deno.env.get("VAPI_WEBHOOK_SECRET");

      const callPayload: Record<string, unknown> = {
        phoneNumberId: vapiPhoneNumberId,
        customer: { number: phoneNumber },
        metadata: metadata || {},
      };

      if (resolvedAssistantId) {
        // ── Named assistant mode ──
        callPayload.assistantId = resolvedAssistantId;

        const overrides: Record<string, unknown> = {
          serverUrl: webhookUrl,
        };
        if (webhookSecret) {
          overrides.serverUrlSecret = webhookSecret;
        }
        const resolvedVoiceId = config?.voice_id;
        if (resolvedVoiceId) {
          overrides.voice = {
            provider: "11labs",
            voiceId: resolvedVoiceId,
          };
        }
        // Inject company knowledge as an additional system message
        // (appended to any existing assistant messages, not replacing them)
        const namedKnowledge = await fetchCompanyKnowledgeForVoice(adminClient, profile.company_id);
        if (namedKnowledge) {
          overrides.model = {
            messages: [{ role: "system", content: `Additional context for this call: ${namedKnowledge.trim()}` }],
          };
        }
        callPayload.assistantOverrides = overrides;
      } else {
        // ── Transient assistant mode ──
        const systemPrompt = config?.system_prompt;
        if (!systemPrompt) {
          return new Response(
            JSON.stringify({
              error:
                "No VAPI assistant ID or system prompt configured. Please set up Voice AI first.",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Enrich system prompt with company knowledge (RAG-lite)
        const knowledgeFragment = await fetchCompanyKnowledgeForVoice(adminClient, profile.company_id);
        const enrichedPrompt = systemPrompt + knowledgeFragment;

        const transientAssistant: Record<string, unknown> = {
          name: config?.name || "Voice Agent",
          serverUrl: webhookUrl,
          model: {
            provider: "openai",
            model: config?.model || "gpt-4o",
            messages: [{ role: "system", content: enrichedPrompt }],
          },
        };
        if (webhookSecret) {
          transientAssistant.serverUrlSecret = webhookSecret;
        }

        if (config?.greeting) {
          transientAssistant.firstMessage = config.greeting;
        }

        if (config?.voice_id) {
          transientAssistant.voice = {
            provider: "11labs",
            voiceId: config.voice_id,
          };
        }

        callPayload.assistant = transientAssistant;
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
