// =============================================================================
// Create Meta Campaign — Spin up a Facebook/Instagram Leads campaign
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
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN")!;
const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeneratedAdCopy {
  meta_headlines?: string[];
  meta_primary_texts?: string[];
  meta_descriptions?: string[];
  ad_image_feed_url?: string;
  ad_image_story_url?: string;
  niche?: string;
}

interface Company {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  meta_ad_account_id: string | null;
  meta_page_id: string | null;
  generated_page_url: string | null;
  generated_ad_copy: GeneratedAdCopy | null;
  lead_goals: unknown;
  max_daily_ad_spend: number | null;
  settings: unknown;
}

// ---------------------------------------------------------------------------
// Meta API helpers
// ---------------------------------------------------------------------------

async function metaPost(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${META_GRAPH_BASE}/${path}`;
  const params = new URLSearchParams({ access_token: META_ACCESS_TOKEN });
  const res = await fetch(`${url}?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(
      `Meta API error [${path}]: ${JSON.stringify(data.error ?? data)}`,
    );
  }
  return data as Record<string, unknown>;
}

async function uploadAdImage(
  accountId: string,
  imageUrl: string,
): Promise<string | null> {
  try {
    const data = await metaPost(`act_${accountId}/adimages`, {
      url: imageUrl,
    });
    // Response: { images: { [filename]: { hash, url, ... } } }
    const images = data.images as Record<string, { hash: string }> | undefined;
    if (!images) return null;
    const firstKey = Object.keys(images)[0];
    return images[firstKey]?.hash ?? null;
  } catch (err) {
    console.warn("uploadAdImage failed:", (err as Error).message);
    return null;
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
        "id, name, slug, logo_url, meta_ad_account_id, meta_page_id, generated_page_url, generated_ad_copy, lead_goals, max_daily_ad_spend, settings",
      )
      .eq("id", company_id)
      .single();

    if (companyErr || !company) {
      return json({ success: false, error: "Company not found" }, 404);
    }

    const co = company as Company;

    // -----------------------------------------------------------------------
    // Step 2 – Load ad copy fields
    // -----------------------------------------------------------------------
    const adCopy: GeneratedAdCopy = co.generated_ad_copy ?? {};
    const headlines: string[] = adCopy.meta_headlines ?? [];
    const primaryTexts: string[] = adCopy.meta_primary_texts ?? [];
    const niche: string = adCopy.niche ?? "General";
    const feedImageUrl: string | null = adCopy.ad_image_feed_url ?? null;
    const storyImageUrl: string | null = adCopy.ad_image_story_url ?? null;

    // -----------------------------------------------------------------------
    // Step 3 – Validate
    // -----------------------------------------------------------------------
    if (!co.meta_ad_account_id) {
      return json(
        { success: false, error: "meta_ad_account_id is required" },
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

    const accountId = co.meta_ad_account_id;
    const pageId: string | null = co.meta_page_id ?? null;
    const landingUrl = co.generated_page_url;

    // -----------------------------------------------------------------------
    // Step 4 – Compute budgets
    // -----------------------------------------------------------------------
    const rawDailySpend = typeof co.max_daily_ad_spend === "number"
      ? co.max_daily_ad_spend
      : 25;
    const metaDailyBudget = Math.round(rawDailySpend * 100); // AUD cents
    const perAdsetBudget = Math.round(metaDailyBudget / 2);

    // -----------------------------------------------------------------------
    // Step 5 – Upload ad images
    // -----------------------------------------------------------------------
    let feedHash: string | null = null;
    let storyHash: string | null = null;

    if (feedImageUrl) {
      feedHash = await uploadAdImage(accountId, feedImageUrl);
    }
    if (storyImageUrl) {
      storyHash = await uploadAdImage(accountId, storyImageUrl);
    }

    // -----------------------------------------------------------------------
    // Step 6 – Create campaign
    // -----------------------------------------------------------------------
    let campaignId: string;
    try {
      const campaignRes = await metaPost(`act_${accountId}/campaigns`, {
        name: `QL | ${co.name} | ${niche} | Leads`,
        objective: "OUTCOME_LEADS",
        status: "ACTIVE",
        special_ad_categories: [],
      });
      campaignId = campaignRes.id as string;
    } catch (err) {
      console.error("Campaign creation failed:", (err as Error).message);
      return json(
        { success: false, error: `Campaign creation failed: ${(err as Error).message}` },
        500,
      );
    }

    // -----------------------------------------------------------------------
    // Step 7 – Create Ad Set 1: Feed placement
    // -----------------------------------------------------------------------
    let adset1Id: string | null = null;
    try {
      const adsetBody: Record<string, unknown> = {
        name: `${co.name} | Feed | Broad`,
        campaign_id: campaignId,
        daily_budget: perAdsetBudget,
        billing_event: "IMPRESSIONS",
        optimization_goal: "LEAD_GENERATION",
        destination_type: "WEBSITE",
        targeting: {
          geo_locations: { countries: ["AU"] },
          age_min: 25,
          age_max: 65,
          publisher_platforms: ["facebook", "instagram"],
          facebook_positions: ["feed", "right_hand_column"],
          instagram_positions: ["stream"],
        },
        status: "ACTIVE",
      };
      if (pageId) {
        adsetBody.promoted_object = { page_id: pageId };
      }
      const adset1Res = await metaPost(`act_${accountId}/adsets`, adsetBody);
      adset1Id = adset1Res.id as string;
    } catch (err) {
      console.warn("Ad Set 1 creation failed:", (err as Error).message);
    }

    // -----------------------------------------------------------------------
    // Step 8 – Create Ad Set 2: Story placement
    // -----------------------------------------------------------------------
    let adset2Id: string | null = null;
    try {
      const adsetBody: Record<string, unknown> = {
        name: `${co.name} | Story | Broad`,
        campaign_id: campaignId,
        daily_budget: perAdsetBudget,
        billing_event: "IMPRESSIONS",
        optimization_goal: "LEAD_GENERATION",
        destination_type: "WEBSITE",
        targeting: {
          geo_locations: { countries: ["AU"] },
          age_min: 25,
          age_max: 65,
          publisher_platforms: ["facebook", "instagram"],
          facebook_positions: ["story"],
          instagram_positions: ["story", "reels"],
        },
        status: "ACTIVE",
      };
      if (pageId) {
        adsetBody.promoted_object = { page_id: pageId };
      }
      const adset2Res = await metaPost(`act_${accountId}/adsets`, adsetBody);
      adset2Id = adset2Res.id as string;
    } catch (err) {
      console.warn("Ad Set 2 creation failed:", (err as Error).message);
    }

    // -----------------------------------------------------------------------
    // Step 9 – Create feed ad creative
    // -----------------------------------------------------------------------
    let feedCreativeId: string | null = null;
    if (feedHash && pageId) {
      try {
        const creativeRes = await metaPost(`act_${accountId}/adcreatives`, {
          name: `${co.name} | Feed Creative`,
          object_story_spec: {
            page_id: pageId,
            link_data: {
              image_hash: feedHash,
              link: landingUrl,
              message: primaryTexts[0] ?? "",
              call_to_action: {
                type: "LEARN_MORE",
                value: { link: landingUrl },
              },
            },
          },
        });
        feedCreativeId = creativeRes.id as string;
      } catch (err) {
        console.warn("Feed creative creation failed:", (err as Error).message);
      }
    } else if (feedHash && !pageId) {
      console.warn(
        "Feed image hash available but no meta_page_id — skipping creative creation. Image hash for manual upload:",
        feedHash,
      );
    }

    // -----------------------------------------------------------------------
    // Step 10 – Create story ad creative
    // -----------------------------------------------------------------------
    let storyCreativeId: string | null = null;
    if (storyHash && pageId) {
      try {
        const creativeRes = await metaPost(`act_${accountId}/adcreatives`, {
          name: `${co.name} | Story Creative`,
          object_story_spec: {
            page_id: pageId,
            link_data: {
              image_hash: storyHash,
              link: landingUrl,
              message: primaryTexts[1] ?? primaryTexts[0] ?? "",
              call_to_action: {
                type: "LEARN_MORE",
                value: { link: landingUrl },
              },
            },
          },
        });
        storyCreativeId = creativeRes.id as string;
      } catch (err) {
        console.warn("Story creative creation failed:", (err as Error).message);
      }
    } else if (storyHash && !pageId) {
      console.warn(
        "Story image hash available but no meta_page_id — skipping creative creation. Image hash for manual upload:",
        storyHash,
      );
    }

    // -----------------------------------------------------------------------
    // Step 11 – Create ads
    // -----------------------------------------------------------------------
    let ad1Id: string | null = null;
    let ad2Id: string | null = null;

    if (adset1Id && feedCreativeId) {
      try {
        const adRes = await metaPost(`act_${accountId}/ads`, {
          name: `${co.name} | Feed Ad`,
          adset_id: adset1Id,
          creative: { creative_id: feedCreativeId },
          status: "ACTIVE",
        });
        ad1Id = adRes.id as string;
      } catch (err) {
        console.warn("Feed ad creation failed:", (err as Error).message);
      }
    }

    if (adset2Id && storyCreativeId) {
      try {
        const adRes = await metaPost(`act_${accountId}/ads`, {
          name: `${co.name} | Story Ad`,
          adset_id: adset2Id,
          creative: { creative_id: storyCreativeId },
          status: "ACTIVE",
        });
        ad2Id = adRes.id as string;
      } catch (err) {
        console.warn("Story ad creation failed:", (err as Error).message);
      }
    }

    // -----------------------------------------------------------------------
    // Step 12 – Update company in Supabase
    // -----------------------------------------------------------------------
    const adSetIds: string[] = [adset1Id, adset2Id].filter(Boolean) as string[];
    const adIds: string[] = [ad1Id, ad2Id].filter(Boolean) as string[];

    const { error: updateErr } = await db
      .from("companies")
      .update({
        meta_campaign_id: campaignId,
        meta_ad_set_ids: adSetIds,
        meta_ad_ids: adIds,
        campaign_status: "active",
        campaigns_created_at: new Date().toISOString(),
      })
      .eq("id", company_id);

    if (updateErr) {
      console.warn("Company update failed:", updateErr.message);
    }

    // -----------------------------------------------------------------------
    // Step 13 – Return result
    // -----------------------------------------------------------------------
    return json({
      success: true,
      campaign_id: campaignId,
      ad_set_ids: adSetIds,
      ad_ids: adIds,
      feed_image_hash: feedHash,
      story_image_hash: storyHash,
    });
  } catch (err) {
    console.error("create-meta-campaign error:", err);
    return json({ success: false, error: "Internal server error" }, 500);
  }
});
