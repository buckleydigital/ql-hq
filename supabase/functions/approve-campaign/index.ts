// =============================================================================
// Approve Campaign — Client approves their campaign preview
// =============================================================================
// Auth: user JWT
// POST { company_id }
// Verifies company belongs to user, updates campaign_status = 'preparing'
// Returns: { success: true }
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const db = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  let companyId: string;
  try {
    const body = await req.json();
    companyId = body?.company_id;
    if (!companyId || typeof companyId !== "string") {
      return json({ error: "company_id is required" }, 400);
    }
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Verify company belongs to user
  const { data: company, error: companyError } = await db
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .single();

  if (companyError || !company) {
    return json({ error: "Company not found or access denied" }, 404);
  }

  // Update campaign_status to 'preparing'
  const { error: updateError } = await db
    .from("companies")
    .update({ campaign_status: "preparing" })
    .eq("id", companyId);

  if (updateError) {
    console.error("[approve-campaign] Update error:", updateError.message);
    return json({ error: "Failed to update campaign status" }, 500);
  }

  return json({ success: true });
});
