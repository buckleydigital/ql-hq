// =============================================================================
// Regenerate Creatives — Re-generate ad creative images on demand
// =============================================================================
// Auth: user JWT
// POST { company_id, prompt? }
// Rate limit: max 10 regenerations per 24h window
// Returns: { success, feed_url, story_url, regenerations_used, remaining }
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

interface SocialProofItem {
  icon: string;
  label: string;
  descriptor: string;
}

interface GeneratedAdCopy {
  niche?: string;
  social_proof_1?: SocialProofItem;
  meta_headlines?: string[];
  ad_image_feed_url?: string;
  ad_image_story_url?: string;
  [key: string]: unknown;
}

interface Company {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  website_url: string | null;
  generated_ad_copy: GeneratedAdCopy | null;
  creative_regeneration_count: number;
  creative_last_regenerated_at: string | null;
  settings: Record<string, unknown>;
}

const NICHE_BG_IMAGES: Record<string, string> = {
  solar:       "https://images.unsplash.com/photo-1509391366360-2e959784a276?w=1080&q=80",
  roofing:     "https://images.unsplash.com/photo-1632207691143-643e2a9a9361?w=1080&q=80",
  hvac:        "https://images.unsplash.com/photo-1631545806609-bbc5b4f7e86e?w=1080&q=80",
  plumbing:    "https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=1080&q=80",
  electrical:  "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=1080&q=80",
  landscaping: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1080&q=80",
  painting:    "https://images.unsplash.com/photo-1562259929-b4e1fd3aef09?w=1080&q=80",
  cleaning:    "https://images.unsplash.com/photo-1563453392212-326f5e854473?w=1080&q=80",
  renovations: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1080&q=80",
  remodeling:  "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1080&q=80",
};

const DEFAULT_BG_IMAGE =
  "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1080&q=80";

async function generateAdCreativeHtml(
  company: Company,
  adCopy: GeneratedAdCopy,
  format: "square" | "story",
  brandColor = "#16a34a",
  fontStyle = "system",
  brandNotes = "",
  userPrompt = "",
): Promise<string> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const width = 1080;
  const height = format === "story" ? 1920 : 1080;
  const niche = adCopy.niche ?? "general";
  const bgImage = NICHE_BG_IMAGES[niche] ?? DEFAULT_BG_IMAGE;
  const formatLabel = format === "story"
    ? "9:16 Instagram/Facebook Story (1080×1920px)"
    : "1:1 Facebook/Instagram Feed (1080×1080px)";

  const headlineFontSize = format === "story" ? "180px" : "130px";

  const fontStack = fontStyle === "modern"
    ? "'Inter', 'Helvetica Neue', Arial, sans-serif"
    : fontStyle === "bold"
    ? "Impact, 'Arial Black', Arial, sans-serif"
    : fontStyle === "classic"
    ? "Georgia, 'Times New Roman', serif"
    : "system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

  const sp1 = adCopy.social_proof_1 ?? { icon: "⭐", label: "500+ clients", descriptor: "satisfied homeowners" };

  const brandInstruction = brandNotes
    ? `\n\nBrand notes: "${brandNotes}" — use the brand colour ${brandColor} throughout.`
    : `\n\nBrand colour: ${brandColor}.`;

  const userChangeInstruction = userPrompt
    ? `\n\nSPECIFIC CHANGES REQUESTED BY CLIENT: "${userPrompt}" — implement these changes while keeping the layout rules intact.`
    : "";

  const prompt =
    `You are an expert Meta ad creative designer. Generate a complete, pixel-perfect, self-contained HTML ad creative optimised for MAXIMUM SCROLL-STOPPING VISUAL IMPACT.

FORMAT: ${formatLabel}
CANVAS: exactly ${width}px wide × ${height}px tall — body must have width:${width}px, height:${height}px, overflow:hidden, margin:0, padding:0

BUSINESS: ${company.name}
NICHE: ${niche}
BRAND COLOUR: ${brandColor}
FONT: ${fontStack}
${brandInstruction}${userChangeInstruction}

THIS IS A PAID SOCIAL AD — NOT A LANDING PAGE.
CRITICAL RULE: MINIMISE TEXT. The image must stop the scroll VISUALLY, not with words.
Maximum 3 text elements total: (1) huge headline, (2) one subline, (3) CTA button.
NO navbar. NO header bar. NO body paragraphs. NO bullet lists. NO long text blocks.

LAYOUT (implement exactly, no deviations):

1. FULL-BLEED BACKGROUND
   • background-image: url('${bgImage}'), cover, center center, no-repeat
   • Dark overlay on top: position:absolute, inset:0, background:rgba(0,0,0,0.68)
   • This is the ENTIRE canvas — no sections, no bars at top

2. BRAND WATERMARK (top-left corner, z-index:2, position:absolute, top:${format === "story" ? "60px" : "40px"}, left:${format === "story" ? "72px" : "52px"})
   • Company name only: "${company.name}"
   • Font: ${format === "story" ? "36px" : "24px"}, font-weight:600, color:rgba(255,255,255,0.55), letter-spacing:0.02em
   • NO pill, NO background, just subtle watermark text

3. HEADLINE (the hero — centre of the canvas, position:absolute, z-index:2)
   • Centred both horizontally and vertically (transform:translate(-50%,-50%), top:45%, left:50%)
   • Text: generate a 2–4 word scroll-stopping headline based on the niche (e.g. "Save Thousands Today" or "Free Quote. Fast.")
   • Font-size: ${headlineFontSize}, font-weight:900, color:#ffffff, line-height:1.0, letter-spacing:-0.04em
   • text-align:center, text-transform:uppercase
   • max-width:${width - 80}px
   • The headline DOMINATES the creative — it should fill 40–50% of the vertical space

4. SUBTEXT (just below headline, position:absolute, z-index:2)
   • 1 line only — max 8 words: a punchy supporting line (e.g. "No obligation. Results guaranteed.")
   • Font-size: ${format === "story" ? "52px" : "34px"}, color:rgba(255,255,255,0.75), font-weight:400
   • text-align:center, centred horizontally (left:50%, transform:translateX(-50%))
   • top: calc(45% + ${format === "story" ? "230px" : "160px"})

5. CTA BUTTON (position:absolute, z-index:2)
   • 2–3 words: action-oriented (e.g. "Get Free Quote")
   • Background: ${brandColor}, color:#ffffff, border-radius:999px
   • Font-size: ${format === "story" ? "46px" : "32px"}, font-weight:700, padding:${format === "story" ? "30px 90px" : "20px 60px"}
   • Centred horizontally (left:50%, transform:translateX(-50%))
   • top: calc(45% + ${format === "story" ? "360px" : "250px"})

6. BOTTOM SOCIAL PROOF STRIP (position:absolute, bottom:0, left:0, right:0, z-index:2)
   • Background: rgba(0,0,0,0.72)
   • Height: ${format === "story" ? "160px" : "110px"}, display:flex, align-items:center, justify-content:center, gap:${format === "story" ? "24px" : "16px"}
   • ONE stat only: icon "${sp1.icon}" at ${format === "story" ? "52px" : "36px"} + bold number/label "${sp1.label}" in ${brandColor} at ${format === "story" ? "44px" : "28px"} font-weight:800 + descriptor "${sp1.descriptor}" in rgba(255,255,255,0.65) at ${format === "story" ? "30px" : "20px"}

ABSOLUTE RULES:
• NO navbar, header, or top bar of any kind
• NO more than 3 text zones (headline + subtext + CTA) plus the watermark and bottom stat
• Headline font-size MUST be ${headlineFontSize} — do not reduce it
• No external resources except the background image URL above
• No interactivity (no JS, no :hover)
• No lorem ipsum, no placeholder text — generate real copy for the ${niche} niche

Return ONLY the complete HTML document — no markdown fences, no explanation, nothing before <!DOCTYPE html> or after </html>.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude creative API error ${res.status}: ${errText}`);
  }

  const claudeResponse = await res.json();
  const rawHtml: string = claudeResponse.content?.[0]?.text?.trim() ?? "";

  return rawHtml
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

async function htmlToPng(
  html: string,
  viewportWidth: number,
  viewportHeight: number,
): Promise<string> {
  const userId = Deno.env.get("HCTI_USER_ID");
  const apiKey = Deno.env.get("HCTI_API_KEY");

  if (!userId || !apiKey) {
    throw new Error("HCTI_USER_ID or HCTI_API_KEY not set");
  }

  const credentials = btoa(`${userId}:${apiKey}`);
  const res = await fetch("https://hcti.io/v1/image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({
      html,
      css: "",
      google_fonts: "",
      viewport_width: viewportWidth,
      viewport_height: viewportHeight,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HCTI error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  if (!data.url) throw new Error("HCTI response missing url");
  return data.url as string;
}

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const userDb = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await userDb.auth.getUser();
  if (authError || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  let companyId: string;
  let userPrompt = "";

  try {
    const body = await req.json();
    companyId = body?.company_id;
    if (!companyId || typeof companyId !== "string") {
      return json({ error: "company_id is required" }, 400);
    }
    if (typeof body?.prompt === "string") {
      userPrompt = body.prompt.trim();
    }
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Verify company belongs to user
  const { data: company, error: companyError } = await userDb
    .from("companies")
    .select("id, name, slug, logo_url, website_url, generated_ad_copy, creative_regeneration_count, creative_last_regenerated_at, settings")
    .eq("id", companyId)
    .single();

  if (companyError || !company) {
    return json({ error: "Company not found or access denied" }, 404);
  }

  const typedCompany = company as Company;

  // Rate limit check
  const now = Date.now();
  const lastRegen = typedCompany.creative_last_regenerated_at
    ? new Date(typedCompany.creative_last_regenerated_at).getTime()
    : 0;
  const withinWindow = (now - lastRegen) < RATE_WINDOW_MS;
  const currentCount = withinWindow ? (typedCompany.creative_regeneration_count ?? 0) : 0;

  if (withinWindow && currentCount >= RATE_LIMIT) {
    return json({
      error: "Rate limit reached",
      remaining: 0,
    }, 429);
  }

  // Use service role for DB writes
  const adminDb = createClient(supabaseUrl, serviceRoleKey);

  // Increment count
  const newCount = currentCount + 1;
  const remaining = RATE_LIMIT - newCount;

  const adCopy = (typedCompany.generated_ad_copy ?? {}) as GeneratedAdCopy;
  const brandColor = (typedCompany.settings?.brand_color as string) ?? "#16a34a";
  const fontStyle = (typedCompany.settings?.font_style as string) ?? "system";
  const brandNotes = (typedCompany.settings?.brand_notes as string) ?? "";

  // Fire-and-forget heavy work
  const pipeline = async () => {
    try {
      const [feedHtml, storyHtml] = await Promise.all([
        generateAdCreativeHtml(typedCompany, adCopy, "square", brandColor, fontStyle, brandNotes, userPrompt),
        generateAdCreativeHtml(typedCompany, adCopy, "story", brandColor, fontStyle, brandNotes, userPrompt),
      ]);

      const [feedUrl, storyUrl] = await Promise.all([
        htmlToPng(feedHtml, 1080, 1080),
        htmlToPng(storyHtml, 1080, 1920),
      ]);

      const updatedAdCopy = {
        ...adCopy,
        ad_image_feed_url: feedUrl,
        ad_image_story_url: storyUrl,
      };

      await adminDb
        .from("companies")
        .update({
          generated_ad_copy: updatedAdCopy,
          creative_regeneration_count: newCount,
          creative_last_regenerated_at: new Date().toISOString(),
        })
        .eq("id", companyId);

      console.log(`[regenerate-creatives] Done. Feed: ${feedUrl}, Story: ${storyUrl}`);
    } catch (err) {
      console.error("[regenerate-creatives] Pipeline error:", err);
      // Still update count even on failure
      await adminDb
        .from("companies")
        .update({
          creative_regeneration_count: newCount,
          creative_last_regenerated_at: new Date().toISOString(),
        })
        .eq("id", companyId)
        .catch(() => {});
    }
  };

  try {
    // @ts-ignore — EdgeRuntime is available in Supabase edge functions
    EdgeRuntime.waitUntil(pipeline());
  } catch {
    pipeline().catch((e) => console.error("[regenerate-creatives] pipeline error:", e));
  }

  return json({
    success: true,
    regenerations_used: newCount,
    remaining,
  });
});
