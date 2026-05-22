// =============================================================================
// Generate Fulfillment — Post-Onboarding Asset Pipeline
// =============================================================================
// Triggered after a company completes onboarding. Orchestrates:
//   1. Website scrape via Jina.ai
//   2. Claude claude-sonnet-4-6 copy generation
//   3. Landing page HTML build from template
//   4. Ad creative HTML build (1080x1080 + 9x16)
//   5. HTML→PNG conversion via htmlcsstoimage.com
//   6. GitHub Pages deployment
//   7. Company record update (generated assets + onboarding_completed = true)
//
// Payload: { company_id: string }
// Auth: Bearer <SUPABASE_SERVICE_ROLE_KEY>
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SocialProofItem {
  icon: string;
  label: string;
  descriptor: string;
}

interface SurveyOption {
  emoji: string;
  title?: string;
  label?: string;
  subtitle: string;
  qualifies?: boolean;
}

interface FactItem {
  icon: string;
  title: string;
  body: string;
}

interface FaqItem {
  q: string;
  a: string;
}

interface GeneratedCopy {
  hero_headline: string;
  hero_subheadline: string;
  hero_body: string;
  cta_text: string;
  trust_badge: string;
  location_pill: string;
  social_proof_1: SocialProofItem;
  social_proof_2: SocialProofItem;
  social_proof_3: SocialProofItem;
  survey_q1_headline: string;
  survey_q1_options: SurveyOption[];
  survey_q2_headline: string;
  survey_q2_options: SurveyOption[];
  survey_q3_headline: string;
  meta_headlines: string[];
  meta_primary_texts: string[];
  meta_descriptions: string[];
  google_headlines: string[];
  google_descriptions: string[];
  google_keywords: string[];
  facts_section: FactItem[];
  faq_items: FaqItem[];
  page_title: string;
  meta_description: string;
  niche: string;
}

interface Company {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  website_url: string | null;
  lead_goals: number | null;
  max_daily_ad_spend: number | null;
  meta_ad_account_id: string | null;
  settings: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Step 1: Load company data
// ---------------------------------------------------------------------------
async function loadCompany(
  db: ReturnType<typeof createClient>,
  companyId: string,
): Promise<{ company: Company; smsConfig: Record<string, unknown> | null }> {
  const { data: company, error } = await db
    .from("companies")
    .select(
      "id, name, slug, logo_url, website_url, lead_goals, max_daily_ad_spend, meta_ad_account_id, settings",
    )
    .eq("id", companyId)
    .single();

  if (error || !company) {
    throw new Error(`Company not found: ${error?.message ?? "no data"}`);
  }

  const { data: smsConfig } = await db
    .from("sms_agent_config")
    .select("ai_enabled, welcome_message, twilio_number")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  return { company: company as Company, smsConfig };
}

// ---------------------------------------------------------------------------
// Step 2: Scrape website via Jina.ai
// ---------------------------------------------------------------------------
async function scrapeWebsite(websiteUrl: string | null): Promise<string> {
  if (!websiteUrl) return "";

  try {
    const jinaUrl = `https://r.jina.ai/${websiteUrl}`;
    const res = await fetch(jinaUrl, {
      headers: {
        Accept: "text/plain",
        "X-Return-Format": "markdown",
      },
    });

    if (!res.ok) {
      console.warn(`Jina scrape failed: ${res.status} for ${websiteUrl}`);
      return "";
    }

    const text = await res.text();
    return text.slice(0, 3000);
  } catch (err) {
    console.warn("Website scrape error:", err);
    return "";
  }
}

// ---------------------------------------------------------------------------
// Step 3: Generate copy with Claude claude-sonnet-4-6
// ---------------------------------------------------------------------------
async function generateCopy(
  companyName: string,
  scrapedContent: string,
): Promise<GeneratedCopy> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const systemPrompt =
    "You are a direct-response copywriter specialising in local service businesses. " +
    "Generate compelling, specific, conversion-focused copy. Always use the actual business name and service. " +
    "Never use placeholder text.";

  const userPrompt = `Generate landing page and ad copy for this business.

Business name: ${companyName}
Website content: ${scrapedContent || "(no website content available)"}

Return a JSON object with these exact keys:
- hero_headline: string (3 lines, ~60-72px display, frames a problem/missed opportunity, no more than 12 words per line)
- hero_subheadline: string (italic, creates tension, max 10 words, e.g. "Most homeowners don't. Yet.")
- hero_body: string (2-3 sentences: lead with a specific dollar or number stat, explain the mechanism, end with low-friction promise)
- cta_text: string (action verb + context noun, e.g. "Get My Free Quote →")
- trust_badge: string (emoji + one bold stat claim, e.g. "⭐ Trusted by 2,400+ local homeowners")
- location_pill: string (📍 + city/region context)
- social_proof_1: { icon: string, label: string, descriptor: string }
- social_proof_2: { icon: string, label: string, descriptor: string }
- social_proof_3: { icon: string, label: string, descriptor: string }
- survey_q1_headline: string (homeownership/qualification question for their niche)
- survey_q1_options: Array<{ emoji: string, title: string, subtitle: string, qualifies: boolean }>
- survey_q2_headline: string (budget/scale question for their niche)
- survey_q2_options: Array<{ emoji: string, label: string, subtitle: string }>
- survey_q3_headline: string (timeline question)
- meta_headlines: string[] (5 Meta ad headlines, max 40 chars each)
- meta_primary_texts: string[] (2 primary texts, max 125 chars each)
- meta_descriptions: string[] (2 descriptions, max 30 chars each)
- google_headlines: string[] (15 Google RSA headlines, max 30 chars each)
- google_descriptions: string[] (4 Google RSA descriptions, max 90 chars each)
- google_keywords: string[] (20 keywords for their niche, mix of exact and phrase match)
- facts_section: Array<{ icon: string, title: string, body: string }> (6 facts)
- faq_items: Array<{ q: string, a: string }> (6 FAQs)
- page_title: string (SEO title, max 60 chars)
- meta_description: string (SEO meta description, max 155 chars)
- niche: string (one word: solar/roofing/hvac/plumbing/electrical/landscaping/renovations/remodeling/painting/cleaning)

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
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }

  const claudeResponse = await res.json();
  const rawText: string =
    claudeResponse.content?.[0]?.text?.trim() ?? "{}";

  // Strip markdown fences if Claude included them despite instructions
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as GeneratedCopy;
  } catch {
    throw new Error(`Failed to parse Claude JSON response: ${cleaned.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Step 4: Build landing page HTML
// ---------------------------------------------------------------------------
function getNicheIcon(niche: string): string {
  const icons: Record<string, string> = {
    solar:
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    roofing:
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    plumbing:
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    electrical:
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    hvac: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 16a4 4 0 0 1 8 0"/><path d="M12 3v1"/><path d="M3.05 11H4"/><path d="M20 11h.95"/><path d="M6.57 6.57l.71.71"/><path d="M16.72 6.57l.71-.71"/><path d="M12 12a4 4 0 0 1 4 4H8a4 4 0 0 1 4-4z"/><rect x="4" y="19" width="16" height="2" rx="1"/></svg>',
    landscaping:
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V12"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><path d="M6 6c0 4 3 7 6 8"/><path d="M18 6c0 4-3 7-6 8"/><path d="M13 2c0 2.5-1 5-1 5S11 4.5 11 2a1 1 0 0 1 2 0z"/></svg>',
    renovations:
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h20"/><path d="M5 20V8l7-5 7 5v12"/><path d="M9 20v-5h6v5"/><rect x="9" y="9" width="2" height="2"/><rect x="13" y="9" width="2" height="2"/></svg>',
    painting:
      '<svg xmlns="http://www.w3.org/2020/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 3H5c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/><path d="M12 12v9"/><path d="M8 21h8"/></svg>',
    cleaning:
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  };
  return (
    icons[niche] ??
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
  );
}

function buildLogoHtml(companyName: string): string {
  const words = companyName.trim().split(/\s+/);
  if (words.length === 1) return `<span>${words[0]}</span>`;
  const first = words[0];
  const rest = words.slice(1).join(" ");
  return `${first} <em>${rest}</em>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildLandingPageHtml(
  company: Company,
  copy: GeneratedCopy,
  supabaseUrl: string,
): string {
  const intakeUrl = `${supabaseUrl}/functions/v1/intake-lead`;
  const companyId = company.id;
  const niche = copy.niche ?? "general";
  const nicheIcon = getNicheIcon(niche);
  const logoHtml = buildLogoHtml(company.name);

  // Headline: split on newlines or | or — treat as 3 separate lines
  const headlineLines = copy.hero_headline
    .split(/\n|<br\s*\/?>/i)
    .map((l) => l.trim())
    .filter(Boolean);
  const headlineHtml = headlineLines
    .map((l) => escapeHtml(l))
    .join("<br>");

  // Survey Q1 options
  const q1OptionsHtml = (copy.survey_q1_options ?? [])
    .map(
      (opt) => `
        <button class="survey-option" onclick="selectOption(this, 'q1', '${escapeHtml(opt.title ?? opt.label ?? "")}', ${opt.qualifies !== false})" data-value="${escapeHtml(opt.title ?? opt.label ?? "")}">
          <span class="survey-option-emoji">${escapeHtml(opt.emoji)}</span>
          <span class="survey-option-text">
            <strong>${escapeHtml(opt.title ?? opt.label ?? "")}</strong>
            <small>${escapeHtml(opt.subtitle ?? "")}</small>
          </span>
        </button>`,
    )
    .join("\n");

  // Survey Q2 options (tile format)
  const q2OptionsHtml = (copy.survey_q2_options ?? [])
    .map(
      (opt) => `
        <button class="survey-tile" onclick="selectTile(this, 'q2', '${escapeHtml(opt.label ?? opt.title ?? "")}')">
          <span class="survey-tile-emoji">${escapeHtml(opt.emoji)}</span>
          <strong>${escapeHtml(opt.label ?? opt.title ?? "")}</strong>
          <small>${escapeHtml(opt.subtitle ?? "")}</small>
        </button>`,
    )
    .join("\n");

  // Facts
  const factsHtml = (copy.facts_section ?? [])
    .map(
      (f) => `
      <div class="fact-card">
        <div class="fact-icon">${escapeHtml(f.icon)}</div>
        <h3>${escapeHtml(f.title)}</h3>
        <p>${escapeHtml(f.body)}</p>
      </div>`,
    )
    .join("\n");

  // FAQs
  const faqHtml = (copy.faq_items ?? [])
    .map(
      (item, i) => `
      <div class="faq-item">
        <button class="faq-question" onclick="toggleFaq(${i})">
          ${escapeHtml(item.q)}
          <span class="faq-chevron" id="faq-chevron-${i}">▼</span>
        </button>
        <div class="faq-answer" id="faq-answer-${i}" style="display:none">
          <p>${escapeHtml(item.a)}</p>
        </div>
      </div>`,
    )
    .join("\n");

  // Reviews (niche-adapted placeholder names)
  const reviewNames: Record<string, Array<{ name: string; loc: string; stat: string }>> = {
    solar: [
      { name: "Sarah M.", loc: "Brisbane, QLD", stat: "Saving $310/month" },
      { name: "James T.", loc: "Sydney, NSW", stat: "ROI in 4.2 years" },
      { name: "Emma L.", loc: "Melbourne, VIC", stat: "Saving $280/month" },
      { name: "David K.", loc: "Perth, WA", stat: "Saving $350/month" },
      { name: "Lisa R.", loc: "Adelaide, SA", stat: "ROI in 5.1 years" },
      { name: "Mark W.", loc: "Gold Coast, QLD", stat: "Saving $290/month" },
    ],
    roofing: [
      { name: "Paul H.", loc: "Brisbane, QLD", stat: "No leak in 3 years" },
      { name: "Sue K.", loc: "Sydney, NSW", stat: "Done in 2 days" },
      { name: "Tom B.", loc: "Melbourne, VIC", stat: "10 yr warranty" },
      { name: "Jen A.", loc: "Perth, WA", stat: "On budget" },
      { name: "Rob C.", loc: "Adelaide, SA", stat: "Immaculate finish" },
      { name: "Fiona D.", loc: "Gold Coast, QLD", stat: "Highly recommend" },
    ],
  };
  const reviews = reviewNames[niche] ?? [
    { name: "Sarah M.", loc: "Local Area", stat: "Great result" },
    { name: "James T.", loc: "Local Area", stat: "Fast & professional" },
    { name: "Emma L.", loc: "Local Area", stat: "Will use again" },
    { name: "David K.", loc: "Local Area", stat: "Excellent service" },
    { name: "Lisa R.", loc: "Local Area", stat: "Top quality work" },
    { name: "Mark W.", loc: "Local Area", stat: "Highly recommend" },
  ];

  const reviewsHtml = reviews
    .map(
      (r) => `
      <div class="review-card">
        <div class="review-stars">⭐⭐⭐⭐⭐</div>
        <p>"${company.name} was outstanding — professional, fast and transparent on pricing. ${r.stat}."</p>
        <div class="review-author">
          <strong>${r.name}</strong>
          <span>${r.loc}</span>
        </div>
      </div>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(copy.page_title)}</title>
  <meta name="description" content="${escapeHtml(copy.meta_description)}" />

  <!-- Meta Pixel -->
  <script>
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');
  /* PIXEL_ID: ${escapeHtml(company.meta_ad_account_id ?? "SET_PIXEL_ID")} */
  fbq('init', '${escapeHtml(company.meta_ad_account_id ?? "SET_PIXEL_ID")}');
  fbq('track', 'PageView');
  </script>
  <noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${escapeHtml(company.meta_ad_account_id ?? "SET_PIXEL_ID")}&ev=PageView&noscript=1"/></noscript>

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --green: #16a34a;
      --green-light: #22c55e;
      --dark: #0f2d1f;
      --dark-soft: #1a3a2a;
      --text: #1a1a1a;
      --text-muted: #6b7280;
      --border: #e5e7eb;
      --white: #ffffff;
      --radius: 12px;
      --shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    html { scroll-behavior: smooth; }
    body { font-family: system-ui, -apple-system, 'Helvetica Neue', sans-serif; color: var(--text); background: var(--white); }

    /* ── Navbar ── */
    .navbar {
      position: sticky; top: 0; z-index: 100;
      background: var(--dark); padding: 0 24px;
      display: flex; align-items: center; justify-content: space-between;
      height: 64px; box-shadow: 0 2px 12px rgba(0,0,0,0.3);
    }
    .logo { display: flex; align-items: center; gap: 10px; color: var(--white); text-decoration: none; }
    .logo-icon { color: var(--green-light); display: flex; align-items: center; }
    .logo-text { font-size: 1.2rem; font-weight: 700; letter-spacing: -0.02em; }
    .logo-text em { font-style: normal; color: var(--green-light); }
    .nav-pill {
      font-size: 0.75rem; border: 1px solid rgba(255,255,255,0.3);
      color: rgba(255,255,255,0.85); padding: 4px 12px; border-radius: 999px;
    }

    /* ── Hero ── */
    .hero {
      min-height: 100vh; position: relative; overflow: hidden;
      display: flex; flex-direction: column; justify-content: center;
      padding: 80px 24px 60px;
    }
    .hero-bg {
      position: absolute; inset: 0; background-size: cover; background-position: center;
      filter: brightness(0.35);
    }
    .hero-content { position: relative; z-index: 1; max-width: 720px; margin: 0 auto; }
    .trust-badge {
      display: inline-block; background: rgba(22,163,74,0.9);
      color: var(--white); font-size: 0.85rem; font-weight: 600;
      padding: 6px 16px; border-radius: 999px; margin-bottom: 28px;
    }
    .hero h1 {
      font-size: clamp(2.4rem, 6vw, 4rem); font-weight: 900; line-height: 1.08;
      color: var(--white); letter-spacing: -0.03em; margin-bottom: 20px;
    }
    .contrast-block {
      display: inline-block; background: var(--green); color: var(--white);
      font-style: italic; font-size: 1.1rem; font-weight: 600;
      padding: 8px 20px; border-radius: 6px; margin-bottom: 20px;
    }
    .hero-body { color: rgba(255,255,255,0.88); font-size: 1.05rem; line-height: 1.65; margin-bottom: 36px; }
    .cta-btn {
      display: inline-block; background: var(--green); color: var(--white);
      font-size: 1.1rem; font-weight: 700; padding: 16px 40px;
      border-radius: 999px; text-decoration: none; cursor: pointer; border: none;
      transition: background 0.2s, transform 0.15s; letter-spacing: -0.01em;
    }
    .cta-btn:hover { background: var(--green-light); transform: translateY(-2px); }

    /* ── Social proof bar ── */
    .proof-bar {
      background: var(--dark); color: var(--white);
      display: grid; grid-template-columns: repeat(3, 1fr);
      padding: 28px 24px; gap: 16px;
    }
    .proof-item { text-align: center; }
    .proof-icon { font-size: 1.8rem; margin-bottom: 6px; }
    .proof-label { font-size: 1.25rem; font-weight: 800; color: var(--green-light); }
    .proof-desc { font-size: 0.78rem; color: rgba(255,255,255,0.65); }

    /* ── Survey ── */
    .survey-section {
      background: #f9fafb; padding: 64px 24px;
    }
    .survey-inner { max-width: 640px; margin: 0 auto; }
    .survey-step { display: none; }
    .survey-step.active { display: block; }
    .survey-headline {
      font-size: 1.6rem; font-weight: 800; text-align: center;
      margin-bottom: 32px; color: var(--dark); letter-spacing: -0.02em;
    }
    .survey-options { display: flex; flex-direction: column; gap: 12px; }
    .survey-option {
      display: flex; align-items: center; gap: 16px;
      background: var(--white); border: 2px solid var(--border);
      border-radius: var(--radius); padding: 16px 20px;
      cursor: pointer; text-align: left; transition: border-color 0.2s, box-shadow 0.2s;
      width: 100%;
    }
    .survey-option:hover, .survey-option.selected {
      border-color: var(--green); box-shadow: 0 0 0 3px rgba(22,163,74,0.12);
    }
    .survey-option-emoji { font-size: 1.8rem; flex-shrink: 0; }
    .survey-option-text { display: flex; flex-direction: column; }
    .survey-option-text strong { font-size: 1rem; font-weight: 700; color: var(--dark); }
    .survey-option-text small { font-size: 0.82rem; color: var(--text-muted); margin-top: 2px; }
    .survey-tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .survey-tile {
      display: flex; flex-direction: column; align-items: center;
      gap: 8px; background: var(--white); border: 2px solid var(--border);
      border-radius: var(--radius); padding: 20px 12px;
      cursor: pointer; text-align: center; transition: border-color 0.2s, box-shadow 0.2s;
    }
    .survey-tile:hover, .survey-tile.selected {
      border-color: var(--green); box-shadow: 0 0 0 3px rgba(22,163,74,0.12);
    }
    .survey-tile-emoji { font-size: 2rem; }
    .survey-tile strong { font-size: 0.9rem; font-weight: 700; color: var(--dark); }
    .survey-tile small { font-size: 0.78rem; color: var(--text-muted); }
    .survey-q3-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .survey-q3-item {
      background: var(--white); border: 2px solid var(--border);
      border-radius: var(--radius); padding: 18px 12px; text-align: center;
      cursor: pointer; transition: border-color 0.2s, box-shadow 0.2s;
    }
    .survey-q3-item:hover, .survey-q3-item.selected {
      border-color: var(--green); box-shadow: 0 0 0 3px rgba(22,163,74,0.12);
    }
    .survey-q3-item strong { display: block; font-size: 0.95rem; font-weight: 700; color: var(--dark); }
    .survey-q3-item small { font-size: 0.78rem; color: var(--text-muted); }

    /* Contact form */
    .contact-form { display: flex; flex-direction: column; gap: 14px; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .form-field { display: flex; flex-direction: column; gap: 6px; }
    .form-field label { font-size: 0.85rem; font-weight: 600; color: var(--dark); }
    .form-field input {
      border: 2px solid var(--border); border-radius: 8px;
      padding: 12px 14px; font-size: 1rem; outline: none;
      transition: border-color 0.2s;
    }
    .form-field input:focus { border-color: var(--green); }
    .submit-btn {
      background: var(--green); color: var(--white); border: none;
      border-radius: 999px; padding: 16px; font-size: 1.05rem;
      font-weight: 700; cursor: pointer; transition: background 0.2s;
      margin-top: 4px;
    }
    .submit-btn:hover { background: var(--green-light); }
    .submit-btn:disabled { background: #9ca3af; cursor: not-allowed; }
    .form-legal { font-size: 0.72rem; color: var(--text-muted); text-align: center; }
    .form-success {
      text-align: center; padding: 32px; background: #f0fdf4;
      border-radius: var(--radius); border: 2px solid #bbf7d0;
    }
    .form-success h3 { color: var(--green); font-size: 1.4rem; font-weight: 800; margin-bottom: 8px; }

    /* ── Facts ── */
    .facts-section { padding: 80px 24px; background: var(--white); }
    .facts-inner { max-width: 1000px; margin: 0 auto; }
    .section-title {
      text-align: center; font-size: 2rem; font-weight: 800;
      color: var(--dark); margin-bottom: 48px; letter-spacing: -0.02em;
    }
    .facts-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
    .fact-card {
      background: #f9fafb; border-radius: var(--radius);
      padding: 28px 24px; border: 1px solid var(--border);
    }
    .fact-icon { font-size: 2rem; margin-bottom: 12px; }
    .fact-card h3 { font-size: 1rem; font-weight: 700; margin-bottom: 8px; color: var(--dark); }
    .fact-card p { font-size: 0.88rem; color: var(--text-muted); line-height: 1.6; }

    /* ── Reviews ── */
    .reviews-section { padding: 80px 24px; background: #f9fafb; }
    .reviews-inner { max-width: 1100px; margin: 0 auto; }
    .reviews-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
    .review-card {
      background: var(--white); border-radius: var(--radius);
      padding: 24px; border: 1px solid var(--border); box-shadow: var(--shadow);
    }
    .review-stars { font-size: 1rem; margin-bottom: 12px; }
    .review-card p { font-size: 0.9rem; line-height: 1.6; color: #374151; margin-bottom: 16px; }
    .review-author { display: flex; flex-direction: column; }
    .review-author strong { font-size: 0.9rem; color: var(--dark); }
    .review-author span { font-size: 0.78rem; color: var(--text-muted); }

    /* ── FAQ ── */
    .faq-section { padding: 80px 24px; background: var(--white); }
    .faq-inner { max-width: 720px; margin: 0 auto; }
    .faq-item { border-bottom: 1px solid var(--border); }
    .faq-question {
      width: 100%; display: flex; justify-content: space-between; align-items: center;
      padding: 20px 0; font-size: 1rem; font-weight: 600; color: var(--dark);
      background: none; border: none; cursor: pointer; text-align: left; gap: 16px;
    }
    .faq-chevron { flex-shrink: 0; color: var(--green); transition: transform 0.2s; }
    .faq-answer { padding: 0 0 20px; }
    .faq-answer p { font-size: 0.92rem; color: var(--text-muted); line-height: 1.7; }

    /* ── Footer ── */
    .footer {
      background: var(--dark); color: rgba(255,255,255,0.5);
      padding: 32px 24px; text-align: center; font-size: 0.8rem;
    }
    .footer a { color: var(--green-light); text-decoration: none; }

    @media (max-width: 768px) {
      .proof-bar { grid-template-columns: 1fr; }
      .facts-grid { grid-template-columns: 1fr; }
      .reviews-grid { grid-template-columns: 1fr; }
      .form-row { grid-template-columns: 1fr; }
      .survey-tiles { grid-template-columns: 1fr; }
      .survey-q3-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

<!-- Navbar -->
<nav class="navbar">
  <a class="logo" href="#">
    <span class="logo-icon">${nicheIcon}</span>
    <span class="logo-text">${logoHtml}</span>
  </a>
  <span class="nav-pill">${escapeHtml(copy.location_pill)}</span>
</nav>

<!-- Hero -->
<section class="hero">
  <div class="hero-bg" style="background-image:url('https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1200&q=80')"></div>
  <div class="hero-content">
    <div class="trust-badge">${escapeHtml(copy.trust_badge)}</div>
    <h1>${headlineHtml}</h1>
    <span class="contrast-block">${escapeHtml(copy.hero_subheadline)}</span>
    <p class="hero-body">${escapeHtml(copy.hero_body)}</p>
    <a href="#survey" class="cta-btn">${escapeHtml(copy.cta_text)}</a>
  </div>
</section>

<!-- Social Proof Bar -->
<div class="proof-bar">
  <div class="proof-item">
    <div class="proof-icon">${escapeHtml(copy.social_proof_1.icon)}</div>
    <div class="proof-label">${escapeHtml(copy.social_proof_1.label)}</div>
    <div class="proof-desc">${escapeHtml(copy.social_proof_1.descriptor)}</div>
  </div>
  <div class="proof-item">
    <div class="proof-icon">${escapeHtml(copy.social_proof_2.icon)}</div>
    <div class="proof-label">${escapeHtml(copy.social_proof_2.label)}</div>
    <div class="proof-desc">${escapeHtml(copy.social_proof_2.descriptor)}</div>
  </div>
  <div class="proof-item">
    <div class="proof-icon">${escapeHtml(copy.social_proof_3.icon)}</div>
    <div class="proof-label">${escapeHtml(copy.social_proof_3.label)}</div>
    <div class="proof-desc">${escapeHtml(copy.social_proof_3.descriptor)}</div>
  </div>
</div>

<!-- Survey / Lead Capture -->
<section class="survey-section" id="survey">
  <div class="survey-inner">

    <!-- Step 1 -->
    <div class="survey-step active" id="step-1">
      <h2 class="survey-headline">${escapeHtml(copy.survey_q1_headline)}</h2>
      <div class="survey-options">
        ${q1OptionsHtml}
      </div>
    </div>

    <!-- Step 2 -->
    <div class="survey-step" id="step-2">
      <h2 class="survey-headline">${escapeHtml(copy.survey_q2_headline)}</h2>
      <div class="survey-tiles">
        ${q2OptionsHtml}
      </div>
    </div>

    <!-- Step 3: Timeline -->
    <div class="survey-step" id="step-3">
      <h2 class="survey-headline">${escapeHtml(copy.survey_q3_headline)}</h2>
      <div class="survey-q3-grid">
        <div class="survey-q3-item" onclick="selectQ3(this, 'ASAP')">
          <strong>⚡ ASAP</strong>
          <small>I'm ready to move forward</small>
        </div>
        <div class="survey-q3-item" onclick="selectQ3(this, '1-3 Months')">
          <strong>📅 1–3 Months</strong>
          <small>Planning ahead</small>
        </div>
        <div class="survey-q3-item" onclick="selectQ3(this, '3-6 Months')">
          <strong>🗓️ 3–6 Months</strong>
          <small>Early research stage</small>
        </div>
        <div class="survey-q3-item" onclick="selectQ3(this, 'Exploring')">
          <strong>🔍 Just Exploring</strong>
          <small>Gathering information</small>
        </div>
      </div>
    </div>

    <!-- Step 4: Contact form -->
    <div class="survey-step" id="step-4">
      <h2 class="survey-headline">Almost there — where should we send your free quote?</h2>
      <div id="contact-form-wrap">
        <form class="contact-form" id="contact-form" onsubmit="submitForm(event)">
          <div class="form-row">
            <div class="form-field">
              <label for="f-first">First Name</label>
              <input id="f-first" name="first_name" type="text" required placeholder="Jane" />
            </div>
            <div class="form-field">
              <label for="f-last">Last Name</label>
              <input id="f-last" name="last_name" type="text" required placeholder="Smith" />
            </div>
          </div>
          <div class="form-field">
            <label for="f-email">Email Address</label>
            <input id="f-email" name="email" type="email" required placeholder="jane@example.com" />
          </div>
          <div class="form-field">
            <label for="f-phone">Phone Number</label>
            <input id="f-phone" name="phone" type="tel" required placeholder="04XX XXX XXX" />
          </div>
          <div class="form-field">
            <label for="f-postcode">Postcode</label>
            <input id="f-postcode" name="postcode" type="text" placeholder="3000" />
          </div>
          <button type="submit" class="submit-btn" id="submit-btn">${escapeHtml(copy.cta_text)}</button>
          <p class="form-legal">By submitting you agree to be contacted by ${escapeHtml(company.name)}. No spam, ever.</p>
        </form>
        <div id="form-success" class="form-success" style="display:none">
          <h3>✅ You're on the list!</h3>
          <p>We'll be in touch within 24 hours with your personalised quote.</p>
        </div>
      </div>
    </div>

  </div>
</section>

<!-- Facts -->
<section class="facts-section">
  <div class="facts-inner">
    <h2 class="section-title">Why Choose ${escapeHtml(company.name)}?</h2>
    <div class="facts-grid">
      ${factsHtml}
    </div>
  </div>
</section>

<!-- Reviews -->
<section class="reviews-section">
  <div class="reviews-inner">
    <h2 class="section-title">What Our Customers Say</h2>
    <div class="reviews-grid">
      ${reviewsHtml}
    </div>
  </div>
</section>

<!-- FAQ -->
<section class="faq-section">
  <div class="faq-inner">
    <h2 class="section-title">Frequently Asked Questions</h2>
    <div class="faq-list">
      ${faqHtml}
    </div>
  </div>
</section>

<!-- Footer -->
<footer class="footer">
  <p>&copy; ${new Date().getFullYear()} ${escapeHtml(company.name)}. All rights reserved.</p>
</footer>

<script>
  // Survey state
  var formData = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    postcode: '',
    ownership_type: '',
    matched_buyer: true,
    purchase_timeline: '',
    name: ''
  };
  var currentStep = 1;

  function showStep(n) {
    document.querySelectorAll('.survey-step').forEach(function(el) { el.classList.remove('active'); });
    var el = document.getElementById('step-' + n);
    if (el) { el.classList.add('active'); currentStep = n; }
    document.getElementById('survey').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function selectOption(btn, question, value, qualifies) {
    // Deselect siblings
    btn.closest('.survey-options').querySelectorAll('.survey-option').forEach(function(b) { b.classList.remove('selected'); });
    btn.classList.add('selected');
    if (question === 'q1') {
      formData.ownership_type = value;
      formData.matched_buyer = qualifies !== false;
    }
    setTimeout(function() { showStep(currentStep + 1); }, 300);
  }

  function selectTile(btn, question, value) {
    btn.closest('.survey-tiles').querySelectorAll('.survey-tile').forEach(function(b) { b.classList.remove('selected'); });
    btn.classList.add('selected');
    setTimeout(function() { showStep(currentStep + 1); }, 300);
  }

  function selectQ3(btn, value) {
    document.querySelectorAll('.survey-q3-item').forEach(function(b) { b.classList.remove('selected'); });
    btn.classList.add('selected');
    formData.purchase_timeline = value;
    setTimeout(function() { showStep(4); }, 300);
  }

  function toggleFaq(i) {
    var ans = document.getElementById('faq-answer-' + i);
    var chev = document.getElementById('faq-chevron-' + i);
    if (ans.style.display === 'none') {
      ans.style.display = 'block';
      if (chev) chev.style.transform = 'rotate(180deg)';
    } else {
      ans.style.display = 'none';
      if (chev) chev.style.transform = '';
    }
  }

  async function submitForm(e) {
    e.preventDefault();
    var btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    var first = document.getElementById('f-first').value.trim();
    var last = document.getElementById('f-last').value.trim();
    formData.firstName = first;
    formData.lastName = last;
    formData.name = (first + ' ' + last).trim();
    formData.email = document.getElementById('f-email').value.trim();
    formData.phone = document.getElementById('f-phone').value.trim();
    formData.postcode = document.getElementById('f-postcode').value.trim();

    try {
      if (typeof fbq !== 'undefined') { fbq('track', 'Lead'); }

      await fetch('${intakeUrl}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: '${companyId}',
          name: formData.name,
          first_name: formData.firstName,
          last_name: formData.lastName,
          email: formData.email,
          phone: formData.phone,
          postcode: formData.postcode,
          source: 'Landing Page',
          niche: '${niche}',
          purchase_timeline: formData.purchase_timeline,
          ownership_type: formData.ownership_type,
          matched_buyer: formData.matched_buyer
        })
      });

      document.getElementById('contact-form-wrap').querySelector('form').style.display = 'none';
      document.getElementById('form-success').style.display = 'block';
    } catch(err) {
      console.error('Submit error', err);
      btn.disabled = false;
      btn.textContent = 'Try Again';
      alert('Something went wrong. Please try again.');
    }
  }
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Step 5: Generate ad creative HTML via Claude
// ---------------------------------------------------------------------------

const NICHE_BG_IMAGES: Record<string, string> = {
  solar:        "https://images.unsplash.com/photo-1509391366360-2e959784a276?w=1080&q=80",
  roofing:      "https://images.unsplash.com/photo-1632207691143-643e2a9a9361?w=1080&q=80",
  hvac:         "https://images.unsplash.com/photo-1631545806609-bbc5b4f7e86e?w=1080&q=80",
  plumbing:     "https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=1080&q=80",
  electrical:   "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=1080&q=80",
  landscaping:  "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1080&q=80",
  painting:     "https://images.unsplash.com/photo-1562259929-b4e1fd3aef09?w=1080&q=80",
  cleaning:     "https://images.unsplash.com/photo-1563453392212-326f5e854473?w=1080&q=80",
  renovations:  "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1080&q=80",
  remodeling:   "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1080&q=80",
};

const DEFAULT_BG_IMAGE =
  "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1080&q=80";

async function generateAdCreativeHtml(
  company: Company,
  copy: GeneratedCopy,
  format: "square" | "story",
): Promise<string> {
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const width = 1080;
  const height = format === "story" ? 1920 : 1080;
  const niche = copy.niche ?? "general";
  const bgImage = NICHE_BG_IMAGES[niche] ?? DEFAULT_BG_IMAGE;
  const formatLabel = format === "story"
    ? "9:16 Instagram/Facebook Story (1080×1920px)"
    : "1:1 Facebook/Instagram Feed (1080×1080px)";

  const sp1 = copy.social_proof_1;
  const sp2 = copy.social_proof_2;
  const sp3 = copy.social_proof_3;

  const prompt =
    `You are an expert HTML/CSS ad creative designer. Generate a complete, pixel-perfect, self-contained HTML ad creative.

FORMAT: ${formatLabel}
CANVAS: exactly ${width}px wide × ${height}px tall — body must have overflow:hidden, no scroll

BUSINESS: ${company.name}
NICHE: ${niche}

COPY TO USE (use these exact strings — do not alter them):
• Trust badge:  ${copy.trust_badge}
• Location pill: ${copy.location_pill}
• Headline (split across 2–3 lines): ${copy.hero_headline}
• Subheadline (italic contrast block): ${copy.hero_subheadline}
• Body text: ${copy.hero_body}
• CTA button: ${copy.cta_text}
• Social proof 1: ${sp1.icon}  ${sp1.label} / ${sp1.descriptor}
• Social proof 2: ${sp2.icon}  ${sp2.label} / ${sp2.descriptor}
• Social proof 3: ${sp3.icon}  ${sp3.label} / ${sp3.descriptor}

PROVEN LAYOUT (implement this structure exactly, top to bottom):

1. NAVBAR — full width, dark green (#0f2d1f) background, ${format === "story" ? "120px" : "88px"} tall, flex row space-between, 52px side padding
   • Left: company name in white (heavy weight, letter-spacing -0.02em), ${format === "story" ? "44px" : "32px"} font
   • Right: location pill — pill shape, white border (2px rgba(255,255,255,0.5)), white text, ${format === "story" ? "32px" : "22px"} font

2. HERO — fills remaining space, position:relative, flex column justify-center, ${format === "story" ? "80px 72px" : "64px 72px"} padding
   • Background: full-cover image url('${bgImage}') with a dark overlay (linear-gradient rgba(0,0,0,0.55) to rgba(0,0,0,0.45) or filter:brightness(0.3) on a pseudo-element)
   • All content sits above overlay (z-index:1, position:relative)
   • Trust badge: pill shape, background #16a34a, white text, ${format === "story" ? "34px" : "26px"} bold, margin-bottom ${format === "story" ? "48px" : "36px"}
   • Headline: ${format === "story" ? "80px" : "64px"} font-size, font-weight:900, white, line-height:1.08, letter-spacing:-0.03em, split across multiple <div> or <br> — each line a separate block
   • Contrast block: inline-block, background:#16a34a, white italic text, ${format === "story" ? "42px" : "30px"}, font-weight:700, border-radius:8px, padding ${format === "story" ? "16px 40px" : "12px 28px"}, margin-bottom ${format === "story" ? "48px" : "32px"}
   • Body: rgba(255,255,255,0.88), ${format === "story" ? "38px" : "26px"}, line-height:1.55, margin-bottom ${format === "story" ? "64px" : "44px"}
   • CTA button: background:#16a34a, white, ${format === "story" ? "44px" : "32px"} font, font-weight:800, border-radius:999px, padding ${format === "story" ? "28px 80px" : "20px 56px"}

3. SOCIAL PROOF BAR — dark green (#0f2d1f ~97% opacity), flex-shrink:0, 3-column CSS grid, padding ${format === "story" ? "48px 52px" : "32px 52px"}
   • Each column: center-aligned, icon emoji on top (${format === "story" ? "52px" : "38px"}), bold green (#22c55e) label (${format === "story" ? "40px" : "28px"} font-weight:900), then grey descriptor (rgba(255,255,255,0.6), ${format === "story" ? "26px" : "18px"})

DESIGN RULES:
• Font: system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif
• No external resources except the one bg image URL above
• All text must be fully visible — no clipping, no overflow
• No interactivity (no JS, no hover states)
• No lorem ipsum, no placeholder text

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

// ---------------------------------------------------------------------------
// Step 6: Convert HTML to PNG via htmlcsstoimage.com
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Step 7: Push landing page to GitHub Pages
// ---------------------------------------------------------------------------
async function pushToGitHub(
  slug: string,
  companyName: string,
  html: string,
): Promise<string> {
  const token = Deno.env.get("GITHUB_TOKEN");
  const owner = Deno.env.get("GITHUB_OWNER");
  const repo = Deno.env.get("GITHUB_PAGES_REPO");

  if (!token || !owner || !repo) {
    throw new Error("GITHUB_TOKEN, GITHUB_OWNER or GITHUB_PAGES_REPO not set");
  }

  const path = `${slug}/index.html`;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  // Check if file already exists (need its SHA for updates)
  let existingSha: string | undefined;
  try {
    const checkRes = await fetch(apiUrl, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "QuoteLeadsHQ-Fulfillment",
      },
    });
    if (checkRes.ok) {
      const existing = await checkRes.json();
      existingSha = existing.sha;
    }
  } catch {
    // File doesn't exist yet — that's fine
  }

  const content = btoa(
    new TextEncoder()
      .encode(html)
      .reduce((acc, byte) => acc + String.fromCharCode(byte), ""),
  );

  const body: Record<string, string> = {
    message: `Generate landing page for ${companyName}`,
    content,
    branch: "main",
  };
  if (existingSha) body.sha = existingSha;

  const res = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "QuoteLeadsHQ-Fulfillment",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`GitHub push failed ${res.status}: ${errText}`);
  }

  return `https://${owner}.github.io/${repo}/${slug}/`;
}

// ---------------------------------------------------------------------------
// Step 8: Update company record
// ---------------------------------------------------------------------------
async function updateCompany(
  db: ReturnType<typeof createClient>,
  companyId: string,
  {
    pageUrl,
    pageRepo,
    adCopy,
  }: {
    pageUrl: string | null;
    pageRepo: string | null;
    adCopy: Record<string, unknown>;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    onboarding_completed: true,
    generated_ad_copy: adCopy,
  };

  if (pageUrl) patch.generated_page_url = pageUrl;
  if (pageRepo) patch.generated_page_repo = pageRepo;

  const { error } = await db
    .from("companies")
    .update(patch)
    .eq("id", companyId);

  if (error) {
    console.error("Failed to update company record:", error.message);
  }
}

// =============================================================================
// Main handler
// =============================================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── Auth: accept service role key OR a valid user JWT ──────────────────────
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  const keyBytes = new TextEncoder().encode(callerToken);
  const expectedBytes = new TextEncoder().encode(serviceRoleKey);
  let isServiceRole = keyBytes.length === expectedBytes.length && keyBytes.length > 0;
  const len = Math.max(keyBytes.length, expectedBytes.length);
  for (let i = 0; i < len; i++) {
    if ((keyBytes[i] ?? 0) !== (expectedBytes[i] ?? 0)) isServiceRole = false;
  }

  // If not service role, verify it's a valid user JWT via Supabase auth
  if (!isServiceRole) {
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      supabaseAnonKey,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

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

  console.log(`[generate-fulfillment] Starting pipeline for company: ${companyId}`);

  const db = createClient(supabaseUrl, serviceRoleKey);

  // ── Step 1: Load company (sync — needed to return the predicted URL) ─────────
  let company: Company;
  try {
    const result = await loadCompany(db, companyId);
    company = result.company;
    console.log(`[generate-fulfillment] Loaded company: ${company.name}`);
  } catch (err) {
    console.error("[generate-fulfillment] Step 1 failed:", err);
    return json({ error: `Company load failed: ${String(err)}` }, 500);
  }

  // Pre-compute the GitHub Pages URL so the wizard can show it immediately
  const ghOwner = Deno.env.get("GITHUB_OWNER");
  const ghRepo  = Deno.env.get("GITHUB_PAGES_REPO");
  const predictedPageUrl = ghOwner && ghRepo && company.slug
    ? `https://${ghOwner}.github.io/${ghRepo}/${company.slug}/`
    : null;

  // ── Run the rest of the pipeline in the background ───────────────────────────
  // Returns immediately so the wizard doesn't time out waiting.
  const pipeline = runPipeline(db, company, companyId, supabaseUrl);
  try {
    // @ts-ignore — EdgeRuntime is available in Supabase edge functions
    EdgeRuntime.waitUntil(pipeline);
  } catch {
    // Not in edge runtime (local dev) — fire and forget
    pipeline.catch((e) => console.error("[generate-fulfillment] pipeline error:", e));
  }

  return json({
    success: true,
    landing_page_url: predictedPageUrl,
    message: "Generation started in background",
  });
});

// =============================================================================
// Pipeline — all the heavy work, runs after response is sent
// =============================================================================
async function runPipeline(
  db: ReturnType<typeof createClient>,
  company: Company,
  companyId: string,
  supabaseUrl: string,
): Promise<void> {
  // Accumulated errors (non-fatal steps continue)
  const errors: Record<string, string> = {};

  // ── Step 2: Scrape website ──────────────────────────────────────────────────
  let scrapedContent = "";
  try {
    scrapedContent = await scrapeWebsite(company.website_url);
    console.log(
      `[generate-fulfillment] Scraped ${scrapedContent.length} chars from ${company.website_url}`,
    );
  } catch (err) {
    errors.scrape = String(err);
    console.warn("[generate-fulfillment] Step 2 (scrape) failed:", err);
  }

  // ── Step 3: Generate copy ───────────────────────────────────────────────────
  let copy: GeneratedCopy;
  try {
    copy = await generateCopy(company.name, scrapedContent);
    console.log(`[generate-fulfillment] Copy generated. Niche: ${copy.niche}`);
  } catch (err) {
    console.error("[generate-fulfillment] Step 3 (Claude) failed:", err);
    // Claude is required — cannot continue without copy
    await updateCompany(db, companyId, {
      pageUrl: null,
      pageRepo: null,
      adCopy: {},
    });
    return json({ error: `Copy generation failed: ${String(err)}`, errors }, 500);
  }

  // ── Step 4: Build landing page HTML ────────────────────────────────────────
  let landingPageHtml = "";
  try {
    landingPageHtml = buildLandingPageHtml(company, copy, supabaseUrl);
    console.log(`[generate-fulfillment] Landing page HTML built (${landingPageHtml.length} chars)`);
  } catch (err) {
    errors.landing_page_build = String(err);
    console.error("[generate-fulfillment] Step 4 (HTML build) failed:", err);
  }

  // ── Step 5: Generate ad creative HTML via Claude ───────────────────────────
  let feedAdHtml = "";
  let storyAdHtml = "";
  try {
    [feedAdHtml, storyAdHtml] = await Promise.all([
      generateAdCreativeHtml(company, copy, "square"),
      generateAdCreativeHtml(company, copy, "story"),
    ]);
    console.log("[generate-fulfillment] Ad creative HTML generated by Claude");
  } catch (err) {
    errors.ad_html_build = String(err);
    console.error("[generate-fulfillment] Step 5 (ad HTML) failed:", err);
  }

  // ── Step 6: HTML → PNG via HCTI (exact viewport dimensions) ───────────────
  let adImageFeedUrl: string | null = null;
  let adImageStoryUrl: string | null = null;

  if (feedAdHtml) {
    try {
      adImageFeedUrl = await htmlToPng(feedAdHtml, 1080, 1080);
      console.log(`[generate-fulfillment] Feed ad PNG: ${adImageFeedUrl}`);
    } catch (err) {
      errors.ad_png_feed = String(err);
      console.warn("[generate-fulfillment] Step 6 feed PNG failed:", err);
    }
  }

  if (storyAdHtml) {
    try {
      adImageStoryUrl = await htmlToPng(storyAdHtml, 1080, 1920);
      console.log(`[generate-fulfillment] Story ad PNG: ${adImageStoryUrl}`);
    } catch (err) {
      errors.ad_png_story = String(err);
      console.warn("[generate-fulfillment] Step 6 story PNG failed:", err);
    }
  }

  // ── Step 7: Push to GitHub Pages ───────────────────────────────────────────
  let githubPagesUrl: string | null = null;
  let githubRepo: string | null = null;

  if (landingPageHtml && company.slug) {
    const ghOwner = Deno.env.get("GITHUB_OWNER");
    const ghRepo = Deno.env.get("GITHUB_PAGES_REPO");

    try {
      githubPagesUrl = await pushToGitHub(company.slug, company.name, landingPageHtml);
      if (ghOwner && ghRepo) {
        githubRepo = `${ghOwner}/${ghRepo}/${company.slug}/index.html`;
      }
      console.log(`[generate-fulfillment] Deployed to GitHub Pages: ${githubPagesUrl}`);
    } catch (err) {
      errors.github_push = String(err);
      console.warn("[generate-fulfillment] Step 7 (GitHub push) failed:", err);
    }
  }

  // ── Step 8: Update company record (always, even on partial failure) ─────────
  const adCopyPayload: Record<string, unknown> = {
    meta_headlines: copy.meta_headlines ?? [],
    meta_primary_texts: copy.meta_primary_texts ?? [],
    meta_descriptions: copy.meta_descriptions ?? [],
    google_headlines: copy.google_headlines ?? [],
    google_descriptions: copy.google_descriptions ?? [],
    google_keywords: copy.google_keywords ?? [],
    niche: copy.niche ?? "general",
  };
  if (adImageFeedUrl) adCopyPayload.ad_image_feed_url = adImageFeedUrl;
  if (adImageStoryUrl) adCopyPayload.ad_image_story_url = adImageStoryUrl;

  try {
    await updateCompany(db, companyId, {
      pageUrl: githubPagesUrl,
      pageRepo: githubRepo,
      adCopy: adCopyPayload,
    });
    console.log("[generate-fulfillment] Company record updated, onboarding_completed = true");
  } catch (err) {
    errors.company_update = String(err);
    console.error("[generate-fulfillment] Step 8 (DB update) failed:", err);
  }

  // ── Step 9: Kick off campaign creation (non-blocking, fire-and-forget) ───────
  // Only fires if the company has ad account IDs stored — skip silently otherwise.
  const selfBaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (selfBaseUrl && serviceKey) {
    const { data: freshCompany } = await db
      .from("companies")
      .select("meta_ad_account_id, google_ads_customer_id")
      .eq("id", companyId)
      .single();

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    };
    const body = JSON.stringify({ company_id: companyId });

    if (freshCompany?.meta_ad_account_id) {
      fetch(`${selfBaseUrl}/functions/v1/create-meta-campaign`, {
        method: "POST", headers, body,
      }).then(async (r) => {
        if (!r.ok) console.warn("[generate-fulfillment] create-meta-campaign:", await r.text().catch(() => ""));
        else console.log("[generate-fulfillment] Meta campaign creation triggered");
      }).catch((e) => console.warn("[generate-fulfillment] Meta campaign trigger error:", e));
    }

    // Google Ads API requires developer token approval — Google campaigns are
    // set up manually by the QuoteLeadsHQ team. A task appears in /admin when
    // a company has google_ads_customer_id set but no google_campaign_id.
  }

  const hasErrors = Object.keys(errors).length > 0;
  if (hasErrors) {
    console.warn("[generate-fulfillment] Pipeline completed with errors:", errors);
  } else {
    console.log("[generate-fulfillment] Pipeline completed successfully");
  }
}
