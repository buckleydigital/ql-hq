// =============================================================================
// Generate Hooks — AI-powered hook/angle suggestions for ad campaigns
// =============================================================================
// Auth: user JWT
// POST { company_id, website_url?, business_desc? }
// Scrapes website briefly (first 2000 chars via Jina) or uses business_desc
// Calls Claude to generate 5 hook/angle options
// Returns: { hooks: Array<{ angle, headline, body, why }> }
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

interface Hook {
  angle: string;
  headline: string;
  body: string;
  why: string;
}

async function scrapeWebsiteBrief(websiteUrl: string): Promise<string> {
  let normalizedUrl = websiteUrl.trim();
  if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  try {
    const jinaUrl = `https://r.jina.ai/${normalizedUrl}`;
    const res = await fetch(jinaUrl, {
      headers: {
        Accept: "text/plain",
        "X-Return-Format": "markdown",
      },
    });

    if (!res.ok) {
      console.warn(`Jina scrape failed: ${res.status}`);
      return "";
    }

    const text = await res.text();
    return text.slice(0, 2000);
  } catch (err) {
    console.warn("Website scrape error:", err);
    return "";
  }
}

async function generateHooks(
  companyName: string,
  niche: string,
  context: string,
): Promise<Hook[]> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const prompt =
    `Generate 5 distinct, proven hook/angle strategies for ${companyName} in the ${niche} industry.

Business context: ${context || "(not provided)"}

Each hook should use a different emotional or rational appeal (e.g. fear of loss, social proof, urgency, curiosity gap, authority, before/after transformation).

For each hook provide:
- angle: the angle category name (e.g. "Fear of Missing Out", "Urgency", "Social Proof", "Authority", "Before/After Transformation", "Curiosity Gap")
- headline: a 3-5 word scroll-stopping headline using this angle (e.g. "Stop Losing Money Now" or "Join 2,400 Happy Clients")
- body: a supporting one-liner, max 8 words (e.g. "No obligation. Results guaranteed.")
- why: one sentence explaining why this angle works for their niche

Return a JSON object with key "hooks" containing an array of exactly 5 hook objects.
Respond with ONLY valid JSON — no markdown fences, no commentary.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }

  const claudeResponse = await res.json();
  const rawText: string = claudeResponse.content?.[0]?.text?.trim() ?? "{}";

  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return (parsed.hooks ?? parsed) as Hook[];
  } catch {
    throw new Error(`Failed to parse Claude JSON: ${cleaned.slice(0, 200)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Auth: user JWT
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
  let websiteUrl: string | null = null;
  let businessDesc: string | null = null;

  try {
    const body = await req.json();
    companyId = body?.company_id;
    if (!companyId || typeof companyId !== "string") {
      return json({ error: "company_id is required" }, 400);
    }
    if (typeof body?.website_url === "string" && body.website_url.trim()) {
      websiteUrl = body.website_url.trim();
    }
    if (typeof body?.business_desc === "string" && body.business_desc.trim()) {
      businessDesc = body.business_desc.trim();
    }
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Verify company belongs to user
  const { data: company, error: companyError } = await db
    .from("companies")
    .select("id, name, website_url, settings")
    .eq("id", companyId)
    .single();

  if (companyError || !company) {
    return json({ error: "Company not found or access denied" }, 404);
  }

  // Determine niche from settings or default
  const niche = (company.settings as Record<string, string>)?.niche ?? "home services";

  // Get context: scrape website or use business_desc
  let context = businessDesc ?? "";
  const urlToScrape = websiteUrl ?? company.website_url;
  if (!context && urlToScrape) {
    context = await scrapeWebsiteBrief(urlToScrape);
  }

  try {
    const hooks = await generateHooks(company.name, niche, context);
    return json({ hooks });
  } catch (err) {
    console.error("[generate-hooks] Error:", err);
    return json({ error: `Hook generation failed: ${String(err)}` }, 500);
  }
});
