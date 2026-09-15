// =============================================================================
// fulfilment-ai - generate ad copy and creatives
// =============================================================================
// Steps 4 and 5 of the fulfilment flow:
//
//   generate_ad_copy    Claude writes Meta ad copy from what the client told us
//                       in onboarding, into companies.generated_ad_copy.
//   generate_creatives  htmlcsstoimage renders that copy into images, which land
//                       in preview_links so the preview email can attach them.
//
// Separate from team-api on purpose: these two calls reach out to third parties
// and can take tens of seconds, where every team-api action is a fast database
// round trip. Putting a slow, externally-dependent call inside the function that
// also serves the panel's list views means one hung vendor request makes the
// whole panel feel broken.
//
// AUTHORISATION IS THE SAME MODEL AS team-api, re-derived here rather than
// trusted from the caller: profiles.is_team (or is_admin), and a team member may
// only touch a client assigned to them. An ops_manager or admin may touch any.
// The client never reaches this - the tables it writes are hard-locked and it
// requires a team JWT.
//
// REQUIRED SECRETS
//   ANTHROPIC_API_KEY  - the Claude API key (the SDK reads this name itself)
//   HCTI_USER_ID       - htmlcsstoimage.com User ID
//   HCTI_API_KEY       - htmlcsstoimage.com API Key
// Each is checked at the point of use and reported as a clear message rather
// than a stack trace, so a missing key looks like configuration, not a bug.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0";
import { z } from "npm:zod@3";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0/helpers/zod";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── What we ask Claude for ──────────────────────────────────────────────────
// A schema rather than "reply in JSON": the response is validated against this,
// so the panel can render it without defensive parsing, and a malformed
// generation fails loudly here instead of producing a half-empty preview email.
//
// The counts are in the schema because Meta wants several variants to test, and
// asking in prose gets you three headlines one day and seven the next.
const AdCopySchema = z.object({
  headlines: z.array(z.string()).describe("5 headlines, each under 40 characters"),
  primary_texts: z.array(z.string()).describe("3 primary texts, each 2 to 4 short sentences"),
  descriptions: z.array(z.string()).describe("3 link descriptions, each under 30 words"),
  call_to_action: z.string().describe("One of: Get Quote, Learn More, Sign Up, Get Offer"),
  angle: z.string().describe("One sentence on the angle these ads take and why it suits this business"),
  notes_for_team: z.string().describe("Anything the team should check or localise before it goes live"),
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user: caller } } = await userClient.auth.getUser(token);
    if (!caller) return json({ error: "Not authenticated" }, 401);

    const { data: me } = await admin
      .from("profiles").select("is_team, is_admin, full_name, team_role")
      .eq("id", caller.id).maybeSingle();

    const isTeam = me?.is_team === true;
    const isAdmin = me?.is_admin === true;
    const isOps = isTeam && me?.team_role === "ops_manager";
    if (!isTeam && !isAdmin) return json({ error: "Forbidden: Internal Team access required" }, 403);

    const actorName = (me?.full_name as string) || "Internal Team";
    const body = await req.json().catch(() => ({}));
    const { action, company_id: companyId } = body as { action?: string; company_id?: string };
    if (!companyId) return json({ error: "company_id is required" }, 400);

    // Scope: a member only reaches their own assignments.
    if (!(isAdmin || isOps)) {
      const { data: assigned } = await admin
        .from("team_assignments").select("company_id")
        .eq("team_user_id", caller.id).eq("company_id", companyId).maybeSingle();
      if (!assigned) return json({ error: "Forbidden: client not assigned to you" }, 403);
    }

    const { data: company } = await admin
      .from("companies")
      .select("id, name, niche, service_area, plan, website_url, dfy_profile, generated_ad_copy, max_daily_ad_spend")
      .eq("id", companyId).maybeSingle();
    if (!company) return json({ error: "Client not found" }, 404);

    const ctx = { admin, companyId, company, actor: { id: caller.id, name: actorName } };

    if (action === "get_ad_copy") {
      return json({ ad_copy: company.generated_ad_copy ?? null });
    }
    if (action === "generate_ad_copy")   return await generateAdCopy(ctx);
    if (action === "generate_creatives") return await generateCreatives(ctx, body as Record<string, unknown>);

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("fulfilment-ai error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});

type Ctx = {
  admin: ReturnType<typeof createClient>;
  companyId: string;
  company: Record<string, unknown>;
  actor: { id: string; name: string };
};

// ─── Step 4: ad copy ─────────────────────────────────────────────────────────
async function generateAdCopy(ctx: Ctx) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "ANTHROPIC_API_KEY is not set on this project, so ad copy cannot be generated yet." }, 503);
  }

  const c = ctx.company;
  const profile = (c.dfy_profile || {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = profile[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };

  // Everything we actually know, and nothing invented. The onboarding form is
  // the source: if a field is blank we leave it out rather than filling it with
  // a plausible guess, because a guess reads as fact in finished ad copy.
  const facts: string[] = [];
  const add = (label: string, v: unknown) => {
    if (v != null && String(v).trim()) facts.push(`${label}: ${String(v).trim().slice(0, 1200)}`);
  };
  add("Business name", c.name);
  add("Industry", c.niche || pick("industry"));
  add("Service area", c.service_area || pick("service_location"));
  add("Service radius", pick("service_radius"));
  add("Website", c.website_url);
  add("Current offers or promotions", pick("special_offers"));
  add("Products and brands they install", pick("products_brands"));
  add("Anything else they told us", pick("additional_info"));
  add("Max daily ad spend", c.max_daily_ad_spend);

  const client = new Anthropic({ apiKey });

  const system = [
    "You write Meta (Facebook and Instagram) lead generation ad copy for Australian home services businesses.",
    "",
    "Rules, in order of importance:",
    "1. Never invent a fact. No prices, discounts, rebates, guarantees, timeframes, star ratings, review counts, years in business or accreditations unless they appear in the brief below. If the brief is thin, write copy that works without specifics.",
    "2. No claim a regulator would want substantiated. Avoid 'best', 'cheapest', 'number one', and anything absolute.",
    "3. Australian English and Australian context. Write for a homeowner, plainly, no marketing throat-clearing.",
    "4. This is lead generation, so the action is requesting a quote, not buying.",
    "5. Vary the angle across variants so they are genuinely testable, not five rewordings of one line.",
    "6. No emojis. No ALL CAPS. No clickbait. Sentence case for headlines.",
  ].join("\n");

  const prompt = [
    "Write a set of Meta lead generation ads for this business.",
    "",
    "BRIEF (everything we know - do not add to it):",
    facts.length ? facts.map((f) => `  - ${f}`).join("\n") : "  - (No onboarding detail captured yet)",
    "",
    "If the brief lacks something you would normally lean on, note it in notes_for_team rather than inventing it.",
  ].join("\n");

  let parsed: z.infer<typeof AdCopySchema> | null = null;
  let refusal: string | null = null;

  try {
    const res = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(AdCopySchema) },
      // Ad copy for a real client should not silently come back empty because a
      // classifier declined; on a decline the API re-runs on the fallback model
      // inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as Parameters<typeof client.messages.parse>[0]);

    // A refusal is an HTTP 200, so it has to be checked explicitly or it reads
    // as a successful empty generation.
    if (res.stop_reason === "refusal") {
      refusal = res.stop_details?.explanation || "The request was declined.";
    } else {
      parsed = res.parsed_output as z.infer<typeof AdCopySchema> | null;
    }
  } catch (e) {
    const msg = (e as Error).message || "The ad copy request failed";
    console.error("generate_ad_copy failed:", msg);
    // Record the failure on the step so it shows as blocked in the panel rather
    // than looking untouched, which reads as "nobody has tried yet".
    await setStep(ctx, "ad_copy_generated", "blocked", `Generation failed: ${msg}`.slice(0, 500));
    return json({ error: `Ad copy generation failed: ${msg}` }, 502);
  }

  if (refusal) {
    await setStep(ctx, "ad_copy_generated", "blocked", `Declined: ${refusal}`.slice(0, 500));
    return json({ error: `The model declined this request: ${refusal}` }, 422);
  }
  if (!parsed) {
    await setStep(ctx, "ad_copy_generated", "blocked", "The model returned no usable copy");
    return json({ error: "The model returned no usable copy. Try again." }, 502);
  }

  const record = {
    ...parsed,
    generated_at: new Date().toISOString(),
    generated_by: ctx.actor.name,
    model: "claude-opus-5",
  };

  const { error: upErr } = await ctx.admin
    .from("companies").update({ generated_ad_copy: record }).eq("id", ctx.companyId);
  if (upErr) return json({ error: upErr.message }, 500);

  await setStep(ctx, "ad_copy_generated", "done",
    `${parsed.headlines.length} headlines, ${parsed.primary_texts.length} primary texts`);

  return json({ ok: true, ad_copy: record });
}

// ─── Step 5: creatives ───────────────────────────────────────────────────────
// htmlcsstoimage renders an HTML/CSS block to a hosted PNG. The templates below
// are deliberately plain: they are for the client to approve a MESSAGE, not a
// finished design. Anything bespoke is made in Canva and uploaded through the
// existing preview-image upload, which is why the checklist keeps a manual
// creative step alongside this one.
async function generateCreatives(ctx: Ctx, body: Record<string, unknown>) {
  const userId = Deno.env.get("HCTI_USER_ID");
  const apiKey = Deno.env.get("HCTI_API_KEY");
  if (!userId || !apiKey) {
    return json({
      error: "HCTI_USER_ID and HCTI_API_KEY are not set on this project, so creatives cannot be rendered yet. " +
             "Creatives can still be made in Canva and uploaded as preview images.",
    }, 503);
  }

  const copy = (ctx.company.generated_ad_copy || {}) as Record<string, unknown>;
  const headlines = Array.isArray(copy.headlines) ? (copy.headlines as string[]) : [];
  if (!headlines.length) {
    return json({ error: "Generate the ad copy first - the creatives are rendered from it." }, 400);
  }

  const name = String(ctx.company.name || "Your business");
  const area = String(ctx.company.service_area || "");
  const cta  = String(copy.call_to_action || "Get a quote");

  // Three variants from the three strongest headlines, so the client has a
  // genuine choice rather than one take-it-or-leave-it image.
  const wanted = Math.min(Math.max(Number(body.count) || 3, 1), 5);
  const picks = headlines.slice(0, wanted);

  const results: Array<{ url: string; label: string }> = [];
  const failures: string[] = [];

  for (let i = 0; i < picks.length; i++) {
    const html = creativeHtml(picks[i], name, area, cta, i);
    try {
      const res = await fetch("https://hcti.io/v1/image", {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${userId}:${apiKey}`),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          html,
          // 1080x1080, the Meta feed square. device_scale 2 so it is not soft
          // on a retina screen when the client opens the preview email.
          viewport_width: 1080,
          viewport_height: 1080,
          device_scale: 2,
          ms_delay: 250,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.url) {
        failures.push(`Variant ${i + 1}: ${payload?.error || `HTTP ${res.status}`}`);
        continue;
      }
      results.push({ url: payload.url as string, label: `Creative ${i + 1} - ${picks[i]}`.slice(0, 300) });
    } catch (e) {
      failures.push(`Variant ${i + 1}: ${(e as Error).message}`);
    }
  }

  if (!results.length) {
    await setStep(ctx, "creatives_generated", "blocked", `Rendering failed: ${failures.join("; ")}`.slice(0, 500));
    return json({ error: `No creatives could be rendered. ${failures.join("; ")}` }, 502);
  }

  // Into preview_links, which is what the preview email already reads, so a
  // generated creative and a hand-made Canva upload are the same kind of thing
  // from here on.
  const rows = results.map((r) => ({
    company_id: ctx.companyId, kind: "image", url: r.url, label: r.label, created_by: ctx.actor.id,
  }));
  const { error: insErr } = await ctx.admin.from("preview_links").insert(rows);
  if (insErr) return json({ error: insErr.message }, 500);

  await setStep(
    ctx, "creatives_generated",
    failures.length ? "in_progress" : "done",
    failures.length
      ? `${results.length} rendered, ${failures.length} failed: ${failures.join("; ")}`.slice(0, 500)
      : `${results.length} creatives rendered`,
  );

  return json({ ok: true, created: results.length, links: results, failures });
}

// A plain, legible square. Inline CSS and a system font stack on purpose: no
// external fetch means nothing to fail at render time or silently substitute.
function creativeHtml(headline: string, business: string, area: string, cta: string, variant: number): string {
  const esc = (v: string) =>
    String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const themes = [
    { bg: "#0f172a", fg: "#ffffff", accent: "#4797ff", sub: "#a8b3c7" },
    { bg: "#f7f8fb", fg: "#14161c", accent: "#1063d6", sub: "#5b6474" },
    { bg: "#10231c", fg: "#ffffff", accent: "#10b981", sub: "#9fc2b5" },
    { bg: "#1b1526", fg: "#ffffff", accent: "#a78bfa", sub: "#b7abc9" },
    { bg: "#241611", fg: "#ffffff", accent: "#fb923c", sub: "#cbb0a2" },
  ];
  const t = themes[variant % themes.length];
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1080px;height:1080px;background:${t.bg};color:${t.fg};
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
       display:flex;flex-direction:column;justify-content:space-between;padding:88px}
  .eyebrow{font-size:30px;letter-spacing:.14em;text-transform:uppercase;color:${t.accent};font-weight:700}
  .headline{font-size:96px;line-height:1.08;font-weight:800;letter-spacing:-.02em;max-width:880px}
  .area{font-size:38px;color:${t.sub};margin-top:32px}
  .footer{display:flex;align-items:center;justify-content:space-between;gap:24px}
  .biz{font-size:34px;font-weight:600;color:${t.sub};max-width:560px}
  .cta{background:${t.accent};color:${t.bg === "#f7f8fb" ? "#ffffff" : "#0b0e14"};
       font-size:36px;font-weight:700;padding:28px 46px;border-radius:999px;white-space:nowrap}
  .rule{height:10px;width:140px;background:${t.accent};border-radius:999px;margin-bottom:44px}
</style></head><body>
  <div><div class="eyebrow">Free quote</div></div>
  <div>
    <div class="rule"></div>
    <div class="headline">${esc(headline)}</div>
    ${area ? `<div class="area">${esc(area)}</div>` : ""}
  </div>
  <div class="footer">
    <div class="biz">${esc(business)}</div>
    <div class="cta">${esc(cta)}</div>
  </div>
</body></html>`;
}

// ─── Shared: move a step and log it ──────────────────────────────────────────
// Same contract as team-api's setStep and growth-onboarding's: the log line and
// the ql-mc mirror are part of the write, not something each caller remembers.
async function setStep(ctx: Ctx, stepKey: string, status: string, notes: string | null) {
  const settled = status === "done" || status === "skipped";
  const { data: prev } = await ctx.admin
    .from("company_fulfilment").select("status")
    .eq("company_id", ctx.companyId).eq("step_key", stepKey).maybeSingle();

  await ctx.admin.from("company_fulfilment").upsert({
    company_id: ctx.companyId,
    step_key: stepKey,
    status,
    notes: notes ? notes.slice(0, 2000) : null,
    completed_by: settled ? ctx.actor.id : null,
    completed_by_name: settled ? ctx.actor.name : null,
  }, { onConflict: "company_id,step_key" });

  await ctx.admin.from("fulfilment_log").insert({
    company_id: ctx.companyId,
    actor_id: ctx.actor.id,
    actor_name: ctx.actor.name,
    action: "fulfilment.step_set",
    step_key: stepKey,
    from_status: prev?.status ?? "pending",
    to_status: status,
    detail: notes ? { notes: notes.slice(0, 500) } : {},
  });

  const url = Deno.env.get("QL_MC_API_URL");
  const secret = Deno.env.get("QL_MC_API_SECRET");
  if (!url || !secret) return;
  try {
    const { data: sum } = await ctx.admin
      .from("company_fulfilment_summary")
      .select("stage, stage_at, active_status, steps_done, steps_settled, steps_total, blocked_count, next_step_key, next_step_due")
      .eq("company_id", ctx.companyId).maybeSingle();
    if (!sum) return;
    await fetch(`${url}/sync-from-hq`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-secret": secret },
      body: JSON.stringify({ action: "upsert_fulfilment", hq_company_id: ctx.companyId, summary: sum }),
    });
  } catch (e) {
    console.warn("ql-mc mirror failed:", (e as Error).message);
  }
}
