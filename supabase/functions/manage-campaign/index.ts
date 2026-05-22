// =============================================================================
// Manage Campaign — Pause or enable a Meta or Google campaign from the dashboard
// =============================================================================
// Payload: { platform: "meta" | "google", action: "pause" | "enable", company_id: string }
// Auth:    Bearer <user JWT>  (called from dashboard)
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN")!;
const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";

const GOOGLE_ADS_DEVELOPER_TOKEN = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN")!;
const GOOGLE_ADS_MANAGER_CUSTOMER_ID = Deno.env.get(
  "GOOGLE_ADS_MANAGER_CUSTOMER_ID",
)!;
const GOOGLE_ADS_CLIENT_ID = Deno.env.get("GOOGLE_ADS_CLIENT_ID")!;
const GOOGLE_ADS_CLIENT_SECRET = Deno.env.get("GOOGLE_ADS_CLIENT_SECRET")!;
const GOOGLE_ADS_REFRESH_TOKEN = Deno.env.get("GOOGLE_ADS_REFRESH_TOKEN")!;

const GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com/v17";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Platform = "meta" | "google";
type Action = "pause" | "enable";

interface Company {
  id: string;
  meta_campaign_id: string | null;
  meta_ad_set_ids: string[] | null;
  google_campaign_id: string | null;
  google_ads_customer_id: string | null;
}

// ---------------------------------------------------------------------------
// Google OAuth helper
// ---------------------------------------------------------------------------

async function getGoogleAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: GOOGLE_ADS_CLIENT_ID,
      client_secret: GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: GOOGLE_ADS_REFRESH_TOKEN,
    }).toString(),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Google OAuth failed: ${JSON.stringify(data.error ?? data)}`,
    );
  }
  return data.access_token as string;
}

// ---------------------------------------------------------------------------
// Meta API helper — POST to a resource with form-encoded body
// ---------------------------------------------------------------------------

async function metaUpdateStatus(
  resourceId: string,
  status: "ACTIVE" | "PAUSED",
): Promise<void> {
  const url = `${META_GRAPH_BASE}/${resourceId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, access_token: META_ACCESS_TOKEN }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(
      `Meta update error [${resourceId}]: ${JSON.stringify(data.error ?? data)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  // --- Extract JWT from Authorization header ---
  const authHeader = req.headers.get("authorization") ?? "";
  const userToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!userToken) {
    return json({ success: false, error: "Unauthorized — no token" }, 401);
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ success: false, error: "Invalid JSON body" }, 400);
    }

    const { platform, action, company_id } = body as Record<string, unknown>;

    if (
      !platform ||
      !["meta", "google"].includes(platform as string)
    ) {
      return json(
        { success: false, error: "platform must be 'meta' or 'google'" },
        400,
      );
    }

    if (
      !action ||
      !["pause", "enable"].includes(action as string)
    ) {
      return json(
        { success: false, error: "action must be 'pause' or 'enable'" },
        400,
      );
    }

    if (!company_id || typeof company_id !== "string") {
      return json({ success: false, error: "company_id is required" }, 400);
    }

    // -----------------------------------------------------------------------
    // Step 1 – Verify JWT → get user → verify company ownership
    // -----------------------------------------------------------------------

    // Use user-scoped client to verify the JWT
    const userDb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    // Verify the token is valid
    const { data: { user }, error: authErr } = await userDb.auth.getUser(
      userToken,
    );

    if (authErr || !user) {
      return json({ success: false, error: "Unauthorized — invalid token" }, 401);
    }

    // Use service-role client for privileged DB reads
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Look up the user's profile to get their associated company_id
    const { data: profile, error: profileErr } = await db
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    if (profileErr || !profile) {
      return json({ success: false, error: "Profile not found" }, 404);
    }

    if (profile.company_id !== company_id) {
      return json(
        { success: false, error: "Forbidden — company mismatch" },
        403,
      );
    }

    // -----------------------------------------------------------------------
    // Step 2 – Load company campaign IDs
    // -----------------------------------------------------------------------
    const { data: company, error: companyErr } = await db
      .from("companies")
      .select(
        "id, meta_campaign_id, meta_ad_set_ids, google_campaign_id, google_ads_customer_id",
      )
      .eq("id", company_id)
      .single();

    if (companyErr || !company) {
      return json({ success: false, error: "Company not found" }, 404);
    }

    const co = company as Company;

    // -----------------------------------------------------------------------
    // Step 3 – Meta: pause/enable campaign + all ad sets
    // -----------------------------------------------------------------------
    if ((platform as Platform) === "meta") {
      const metaStatus: "ACTIVE" | "PAUSED" =
        (action as Action) === "pause" ? "PAUSED" : "ACTIVE";

      if (!co.meta_campaign_id) {
        return json(
          { success: false, error: "No Meta campaign ID on file" },
          422,
        );
      }

      // Update campaign
      try {
        await metaUpdateStatus(co.meta_campaign_id, metaStatus);
      } catch (err) {
        console.error("Meta campaign update failed:", (err as Error).message);
        return json(
          {
            success: false,
            error: `Meta campaign update failed: ${(err as Error).message}`,
          },
          500,
        );
      }

      // Update each ad set (non-fatal per-item errors)
      const adSetIds: string[] = Array.isArray(co.meta_ad_set_ids)
        ? co.meta_ad_set_ids
        : [];

      for (const adSetId of adSetIds) {
        try {
          await metaUpdateStatus(adSetId, metaStatus);
        } catch (err) {
          console.warn(
            `Meta ad set ${adSetId} update failed:`,
            (err as Error).message,
          );
        }
      }

      // Update DB
      const { error: updateErr } = await db
        .from("companies")
        .update({
          campaign_status: (action as Action) === "pause" ? "paused" : "active",
        })
        .eq("id", company_id);

      if (updateErr) {
        console.warn("Company campaign_status update failed:", updateErr.message);
      }

      return json({ success: true });
    }

    // -----------------------------------------------------------------------
    // Step 4 – Google: pause/enable campaign
    // -----------------------------------------------------------------------
    if ((platform as Platform) === "google") {
      if (!co.google_campaign_id) {
        return json(
          { success: false, error: "No Google campaign ID on file" },
          422,
        );
      }

      if (!co.google_ads_customer_id) {
        return json(
          { success: false, error: "No Google Ads customer ID on file" },
          422,
        );
      }

      // Get fresh access token
      let accessToken: string;
      try {
        accessToken = await getGoogleAccessToken();
      } catch (err) {
        console.error("Google OAuth failed:", (err as Error).message);
        return json(
          { success: false, error: `Google OAuth failed: ${(err as Error).message}` },
          500,
        );
      }

      const googleStatus = (action as Action) === "pause" ? "PAUSED" : "ENABLED";
      const customerId = co.google_ads_customer_id;
      const mccId = GOOGLE_ADS_MANAGER_CUSTOMER_ID.replace(/\D/g, "");

      try {
        const url = `${GOOGLE_ADS_API_BASE}/customers/${customerId}/campaigns:mutate`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN,
            "login-customer-id": mccId,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            operations: [
              {
                update: {
                  resourceName: `customers/${customerId}/campaigns/${co.google_campaign_id}`,
                  status: googleStatus,
                },
                updateMask: "status",
              },
            ],
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(JSON.stringify(data.error ?? data));
        }
      } catch (err) {
        console.error("Google campaign update failed:", (err as Error).message);
        return json(
          {
            success: false,
            error: `Google campaign update failed: ${(err as Error).message}`,
          },
          500,
        );
      }

      // Update DB
      const { error: updateErr } = await db
        .from("companies")
        .update({
          campaign_status: (action as Action) === "pause" ? "paused" : "active",
        })
        .eq("id", company_id);

      if (updateErr) {
        console.warn("Company campaign_status update failed:", updateErr.message);
      }

      return json({ success: true });
    }

    // Should never reach here
    return json({ success: false, error: "Unknown platform" }, 400);
  } catch (err) {
    console.error("manage-campaign error:", err);
    return json({ success: false, error: "Internal server error" }, 500);
  }
});
