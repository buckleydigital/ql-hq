// =============================================================================
// Create Google Campaign — Spin up a Google Ads Search campaign
// =============================================================================
// Payload: { company_id: string }
// Auth:    Bearer <SUPABASE_SERVICE_ROLE_KEY>
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

interface GeneratedAdCopy {
  google_headlines?: string[];
  google_descriptions?: string[];
  google_keywords?: string[];
  niche?: string;
}

interface Company {
  id: string;
  name: string;
  google_ads_customer_id: string | null;
  generated_ad_copy: GeneratedAdCopy | null;
  generated_page_url: string | null;
  max_daily_ad_spend: number | null;
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
// Google Ads REST helper
// ---------------------------------------------------------------------------

async function googlePost(
  customerId: string,
  path: string,
  body: unknown,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const url = `${GOOGLE_ADS_API_BASE}/customers/${customerId}/${path}`;
  const mccId = GOOGLE_ADS_MANAGER_CUSTOMER_ID.replace(/\D/g, "");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN,
      "login-customer-id": mccId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Google Ads API error [${path}]: ${JSON.stringify(data.error ?? data)}`,
    );
  }
  return data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Date helper (YYYYMMDD)
// ---------------------------------------------------------------------------

function todayYYYYMMDD(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

// ---------------------------------------------------------------------------
// Extract resource ID from resource name
// e.g. "customers/123/campaigns/456" → "456"
// ---------------------------------------------------------------------------

function extractId(resourceName: string): string {
  const parts = resourceName.split("/");
  return parts[parts.length - 1];
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

  // --- Auth check ---
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token || token !== SERVICE_ROLE_KEY) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ success: false, error: "Invalid JSON body" }, 400);
    }

    const { company_id } = body as Record<string, unknown>;
    if (!company_id || typeof company_id !== "string") {
      return json({ success: false, error: "company_id is required" }, 400);
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // -----------------------------------------------------------------------
    // Step 1 – Load company
    // -----------------------------------------------------------------------
    const { data: company, error: companyErr } = await db
      .from("companies")
      .select(
        "id, name, google_ads_customer_id, generated_ad_copy, generated_page_url, max_daily_ad_spend",
      )
      .eq("id", company_id)
      .single();

    if (companyErr || !company) {
      return json({ success: false, error: "Company not found" }, 404);
    }

    const co = company as Company;

    // -----------------------------------------------------------------------
    // Step 2 – Validate
    // -----------------------------------------------------------------------
    if (!co.google_ads_customer_id) {
      return json(
        { success: false, error: "google_ads_customer_id is required" },
        422,
      );
    }

    if (!co.generated_page_url) {
      return json(
        {
          success: false,
          error: "generated_page_url is missing — run generate-fulfillment first",
        },
        422,
      );
    }

    const adCopy: GeneratedAdCopy = co.generated_ad_copy ?? {};
    const googleHeadlines: string[] = adCopy.google_headlines ?? [];
    const googleDescriptions: string[] = adCopy.google_descriptions ?? [];
    const googleKeywords: string[] = adCopy.google_keywords ?? [];
    const niche: string = adCopy.niche ?? "General";

    const customerId = co.google_ads_customer_id;
    const landingUrl = co.generated_page_url;
    const dailySpend = typeof co.max_daily_ad_spend === "number"
      ? co.max_daily_ad_spend
      : 25;
    const dailyBudgetMicros = dailySpend * 1_000_000;

    // -----------------------------------------------------------------------
    // Step 3 – Get Google Ads access token
    // -----------------------------------------------------------------------
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

    const gPost = (path: string, payload: unknown) =>
      googlePost(customerId, path, payload, accessToken);

    // -----------------------------------------------------------------------
    // Step 5 – Create campaign budget
    // -----------------------------------------------------------------------
    let budgetResourceName: string;
    try {
      const budgetRes = await gPost("campaignBudgets:mutate", {
        operations: [
          {
            create: {
              name: `QL Budget | ${co.name}`,
              amountMicros: dailyBudgetMicros,
              deliveryMethod: "STANDARD",
            },
          },
        ],
      });
      const results = budgetRes.results as Array<{ resourceName: string }>;
      budgetResourceName = results[0].resourceName;
    } catch (err) {
      console.error("Budget creation failed:", (err as Error).message);
      return json(
        { success: false, error: `Budget creation failed: ${(err as Error).message}` },
        500,
      );
    }

    // -----------------------------------------------------------------------
    // Step 6 – Create campaign
    // -----------------------------------------------------------------------
    let campaignResourceName: string;
    let campaignId: string;
    try {
      const campaignRes = await gPost("campaigns:mutate", {
        operations: [
          {
            create: {
              name: `QL | ${co.name} | ${niche} | Search`,
              advertisingChannelType: "SEARCH",
              status: "ENABLED",
              networkSettings: {
                targetGoogleSearch: true,
                targetSearchNetwork: true,
                targetContentNetwork: false,
              },
              campaignBudget: budgetResourceName,
              biddingStrategyType: "MAXIMIZE_CONVERSIONS",
              startDate: todayYYYYMMDD(),
            },
          },
        ],
      });
      const results = campaignRes.results as Array<{ resourceName: string }>;
      campaignResourceName = results[0].resourceName;
      campaignId = extractId(campaignResourceName);
    } catch (err) {
      console.error("Campaign creation failed:", (err as Error).message);
      return json(
        { success: false, error: `Campaign creation failed: ${(err as Error).message}` },
        500,
      );
    }

    // -----------------------------------------------------------------------
    // Step 7 – Create ad group
    // -----------------------------------------------------------------------
    let adGroupResourceName: string;
    let adGroupId: string;
    try {
      const adGroupRes = await gPost("adGroups:mutate", {
        operations: [
          {
            create: {
              campaign: campaignResourceName,
              name: `${co.name} | Search | ${niche}`,
              status: "ENABLED",
              type: "SEARCH_STANDARD",
              cpcBidMicros: 2_000_000,
            },
          },
        ],
      });
      const results = adGroupRes.results as Array<{ resourceName: string }>;
      adGroupResourceName = results[0].resourceName;
      adGroupId = extractId(adGroupResourceName);
    } catch (err) {
      console.error("Ad group creation failed:", (err as Error).message);
      return json(
        { success: false, error: `Ad group creation failed: ${(err as Error).message}` },
        500,
      );
    }

    // -----------------------------------------------------------------------
    // Step 8 – Create RSA ad
    // -----------------------------------------------------------------------
    const headlines = googleHeadlines
      .slice(0, 15)
      .map((h) => ({ text: h.slice(0, 30) }));

    const descriptions = googleDescriptions
      .slice(0, 4)
      .map((d) => ({ text: d.slice(0, 90) }));

    try {
      await gPost("adGroupAds:mutate", {
        operations: [
          {
            create: {
              adGroup: adGroupResourceName,
              status: "ENABLED",
              ad: {
                responsiveSearchAd: {
                  headlines,
                  descriptions,
                  finalUrls: [landingUrl],
                },
              },
            },
          },
        ],
      });
    } catch (err) {
      console.warn("RSA ad creation failed:", (err as Error).message);
      // Non-fatal: continue to keywords and still return partial success
    }

    // -----------------------------------------------------------------------
    // Step 9 – Create keywords (max 20, batched in one mutate call)
    // -----------------------------------------------------------------------
    const keywords = googleKeywords.slice(0, 20);
    if (keywords.length > 0) {
      try {
        const kwOperations = keywords.map((kw) => ({
          create: {
            adGroup: adGroupResourceName,
            keyword: {
              text: kw,
              matchType: "BROAD",
            },
            status: "ENABLED",
          },
        }));
        await gPost("adGroupCriteria:mutate", { operations: kwOperations });
      } catch (err) {
        console.warn("Keyword creation failed:", (err as Error).message);
        // Non-fatal
      }
    }

    // -----------------------------------------------------------------------
    // Step 10 – Update company in Supabase
    // -----------------------------------------------------------------------
    const { error: updateErr } = await db
      .from("companies")
      .update({
        google_campaign_id: campaignId,
        google_ad_group_id: adGroupId,
        campaign_status: "active",
      })
      .eq("id", company_id);

    if (updateErr) {
      console.warn("Company update failed:", updateErr.message);
    }

    // -----------------------------------------------------------------------
    // Step 11 – Return result
    // -----------------------------------------------------------------------
    return json({
      success: true,
      campaign_id: campaignId,
      ad_group_id: adGroupId,
    });
  } catch (err) {
    console.error("create-google-campaign error:", err);
    return json({ success: false, error: "Internal server error" }, 500);
  }
});
