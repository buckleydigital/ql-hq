// =============================================================================
// fulfilment-ai - generate ad copy and creatives
// =============================================================================
// Steps 4 and 5 of the fulfilment flow:
//
//   generate_ad_copy    Claude writes Meta ad copy from what the client told us
//                       in onboarding, into companies.generated_ad_copy.
//
//   The creative studio (step 5):
//   creative_state      the client's assets, brand colour, note, the creative
//                       direction prompt and the last creative copy.
//   upload_asset / delete_asset
//                       the client's logo and photos (preview-images bucket,
//                       <company>/assets/), listed in company_assets.
//   save_creative_settings  brand colour and this client's note.
//   save_creative_prompt    the house creative direction (admins only).
//   write_creative_copy Claude writes the words for the images, and Google's
//                       headlines and descriptions, from the prompt + brief.
//   save_creative       the panel draws each image on a canvas (sizes are the
//                       team's choice) and sends it here; it lands in
//                       preview_links like a hand-made Canva upload.
//
// Why the panel draws the images rather than this function: a photo creative
// at story size takes over a second of CPU to render in wasm, and an edge
// function gets about two. A browser canvas does it instantly, measures text
// exactly, and costs nothing per image.
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
// Checked at the point of use and reported as a clear message rather than a
// stack trace, so a missing key looks like configuration, not a bug.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0";
import { z } from "npm:zod@4";
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
      .select("id, name, niche, service_area, plan, website_url, dfy_profile, generated_ad_copy, max_daily_ad_spend, brand_color, creative_note, creative_copy")
      .eq("id", companyId).maybeSingle();
    if (!company) return json({ error: "Client not found" }, 404);

    const ctx = { admin, companyId, company, actor: { id: caller.id, name: actorName }, isAdmin };

    if (action === "get_ad_copy") {
      return json({ ad_copy: company.generated_ad_copy ?? null });
    }
    if (action === "generate_ad_copy")   return await generateAdCopy(ctx);
    const b = body as Record<string, unknown>;
    if (action === "creative_state")         return await creativeState(ctx);
    if (action === "upload_asset")           return await uploadAsset(ctx, b);
    if (action === "delete_asset")           return await deleteAsset(ctx, b);
    if (action === "save_creative_settings") return await saveCreativeSettings(ctx, b);
    if (action === "save_creative_prompt")   return await saveCreativePrompt(ctx, b);
    if (action === "write_creative_copy")    return await writeCreativeCopy(ctx, b);
    if (action === "save_creative")          return await saveCreative(ctx, b);

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
  isAdmin: boolean;
};

// Everything we actually know, and nothing invented. The onboarding form is
// the source: if a field is blank we leave it out rather than filling it with
// a plausible guess, because a guess reads as fact in finished ad copy.
function briefFacts(ctx: Ctx): string[] {
  const c = ctx.company;
  const profile = (c.dfy_profile || {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = profile[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
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
  return facts;
}

// ─── Step 4: ad copy ─────────────────────────────────────────────────────────
async function generateAdCopy(ctx: Ctx) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "ANTHROPIC_API_KEY is not set on this project, so ad copy cannot be generated yet." }, 503);
  }

  const facts = briefFacts(ctx);
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
    "7. Never use an em dash or en dash. Use a comma, a full stop or a plain hyphen.",
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

// ─── Step 5: the creative studio ─────────────────────────────────────────────
// A client's own photos and logo, the words Claude writes for the images, and
// the finished images the panel draws. See the header for why the drawing
// happens in the browser.

const BUCKET = "preview-images";
const HEX = /^#[0-9a-f]{6}$/i;

// The house creative direction. Editable by an admin in the panel (stored in
// platform_settings.creative_prompt); this is what applies until they do.
// The hard rules (never invent a fact, lengths, no dashes) are NOT in here:
// they are fixed below, so editing the direction can never switch them off.
const DEFAULT_CREATIVE_PROMPT = [
  "Write the words that go ON the ad images: a headline, one supporting line and a button label.",
  "The images are for Meta (Facebook, Instagram) and Google image ads aimed at homeowners.",
  "",
  "- The headline is read in under two seconds on a phone: 3 to 7 words, a clear homeowner benefit or outcome, not the business name.",
  "- The supporting line adds one concrete reason to act: local, the service area, what the quote involves, a real offer from the brief.",
  "- The button says what happens next: 'Get a free quote', 'Check your roof', 'Book a quote'. 2 to 4 words.",
  "- Each variant takes a different angle (savings, local and trusted, quick and easy, quality of the products) so they can be tested against each other.",
  "- Plain, confident, friendly. Sounds like a local tradie, not an agency.",
].join("\n");

const CreativeCopySchema = z.object({
  variants: z.array(z.object({
    headline: z.string().describe("3 to 7 words, under 45 characters"),
    subline: z.string().describe("One supporting line, under 70 characters"),
    cta: z.string().describe("Button label, 2 to 4 words, under 22 characters"),
    angle: z.string().describe("The angle in a few words, for the team"),
  })).describe("One per requested image variant"),
  google: z.object({
    headlines: z.array(z.string()).describe("5 Google headlines, each 30 characters or fewer"),
    long_headline: z.string().describe("One Google long headline, 90 characters or fewer"),
    descriptions: z.array(z.string()).describe("4 Google descriptions, each 90 characters or fewer"),
  }),
  notes_for_team: z.string().describe("Anything to check before it goes live, or what the brief was missing"),
});

async function creativePrompt(ctx: Ctx): Promise<{ prompt: string; custom: boolean }> {
  const { data } = await ctx.admin.from("platform_settings").select("creative_prompt").eq("id", 1).maybeSingle();
  const custom = String(data?.creative_prompt ?? "").trim();
  return { prompt: custom || DEFAULT_CREATIVE_PROMPT, custom: !!custom };
}

async function creativeState(ctx: Ctx) {
  const [{ data: assets }, p] = await Promise.all([
    ctx.admin.from("company_assets").select("id, kind, url, width, height, label, created_at")
      .eq("company_id", ctx.companyId).order("created_at", { ascending: true }),
    creativePrompt(ctx),
  ]);
  return json({
    assets: assets ?? [],
    brand_color: ctx.company.brand_color ?? null,
    creative_note: ctx.company.creative_note ?? "",
    creative_copy: ctx.company.creative_copy ?? null,
    prompt: p.prompt,
    prompt_is_default: !p.custom,
    default_prompt: DEFAULT_CREATIVE_PROMPT,
    can_edit_prompt: ctx.isAdmin,
    business: { name: ctx.company.name ?? "", area: ctx.company.service_area ?? "" },
  });
}

/** base64 (bare or data: URL) to bytes, or null. */
function decodeImage(data: unknown): Uint8Array | null {
  if (typeof data !== "string" || !data) return null;
  try {
    const raw = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function storeImage(ctx: Ctx, folder: string, data: unknown, contentType: string) {
  // PNG and JPEG only: those are what every ad platform and every browser
  // canvas reads, and the panel converts anything else before sending.
  if (!/^image\/(png|jpeg)$/.test(contentType)) throw new Error("Only PNG or JPG images");
  const bytes = decodeImage(data);
  if (!bytes) throw new Error("Invalid image data");
  if (bytes.length > 10 * 1024 * 1024) throw new Error("Image exceeds 10 MB");
  const path = `${ctx.companyId}/${folder}/${crypto.randomUUID()}.${contentType === "image/png" ? "png" : "jpg"}`;
  const { error } = await ctx.admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(error.message);
  const { data: pub } = ctx.admin.storage.from(BUCKET).getPublicUrl(path);
  return { path, url: pub.publicUrl };
}

async function uploadAsset(ctx: Ctx, b: Record<string, unknown>) {
  const kind = b.kind === "logo" ? "logo" : "photo";
  let stored;
  try {
    stored = await storeImage(ctx, "assets", b.data, String(b.content_type || ""));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  // One logo per client: a new one replaces the old.
  if (kind === "logo") {
    const { data: old } = await ctx.admin.from("company_assets").select("id, path")
      .eq("company_id", ctx.companyId).eq("kind", "logo");
    if (old?.length) {
      await ctx.admin.storage.from(BUCKET).remove(old.map((o) => o.path as string));
      await ctx.admin.from("company_assets").delete().in("id", old.map((o) => o.id as string));
    }
  }
  const dim = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
  const { data, error } = await ctx.admin.from("company_assets").insert({
    company_id: ctx.companyId, kind, url: stored.url, path: stored.path,
    width: dim(b.width), height: dim(b.height),
    label: String(b.filename || "").trim().slice(0, 200) || null,
    created_by: ctx.actor.id,
  }).select("id, kind, url, width, height, label, created_at").single();
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, asset: data });
}

async function deleteAsset(ctx: Ctx, b: Record<string, unknown>) {
  const { data: row } = await ctx.admin.from("company_assets").select("id, path")
    .eq("id", String(b.asset_id || "")).eq("company_id", ctx.companyId).maybeSingle();
  if (!row) return json({ error: "No such asset for this client" }, 404);
  await ctx.admin.storage.from(BUCKET).remove([row.path as string]);
  await ctx.admin.from("company_assets").delete().eq("id", row.id);
  return json({ ok: true });
}

async function saveCreativeSettings(ctx: Ctx, b: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  if ("brand_color" in b) {
    const c = String(b.brand_color ?? "").trim();
    if (c && !HEX.test(c)) return json({ error: "Brand colour must be a hex colour like #1063d6" }, 400);
    patch.brand_color = c ? c.toLowerCase() : null;
  }
  if ("creative_note" in b) patch.creative_note = String(b.creative_note ?? "").trim().slice(0, 2000) || null;
  if (!Object.keys(patch).length) return json({ ok: true });
  const { error } = await ctx.admin.from("companies").update(patch).eq("id", ctx.companyId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

async function saveCreativePrompt(ctx: Ctx, b: Record<string, unknown>) {
  if (!ctx.isAdmin) return json({ error: "Only an admin can change the creative direction" }, 403);
  const text = String(b.prompt ?? "").trim().slice(0, 6000);
  // Blank, or identical to the built-in one, means "use the default", so a
  // later improvement to the default reaches everyone who never customised it.
  const value = !text || text === DEFAULT_CREATIVE_PROMPT ? null : text;
  const { error } = await ctx.admin.from("platform_settings").update({ creative_prompt: value }).eq("id", 1);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, prompt_is_default: value === null });
}

async function writeCreativeCopy(ctx: Ctx, b: Record<string, unknown>) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set on this project, so creative copy cannot be written yet." }, 503);

  const count = Math.min(Math.max(Number(b.count) || 3, 1), 8);
  // The note can arrive with the request so what is in the box is what is used,
  // saved or not.
  const note = String(b.creative_note ?? ctx.company.creative_note ?? "").trim().slice(0, 2000);
  const { prompt: direction } = await creativePrompt(ctx);
  const facts = briefFacts(ctx);
  const meta = (ctx.company.generated_ad_copy || {}) as Record<string, unknown>;

  const system = [
    "You write the image text for lead generation ads for Australian home services businesses.",
    "",
    "Fixed rules, which override anything in the creative direction:",
    "1. Never invent a fact. No prices, discounts, rebates, guarantees, timeframes, star ratings, review counts, years in business or accreditations unless they appear in the brief. If the brief is thin, write copy that works without specifics.",
    "2. No claim a regulator would want substantiated: no 'best', 'cheapest', 'number one', nothing absolute.",
    "3. Australian English. No emojis, no ALL CAPS, no clickbait. Sentence case.",
    "4. Never use an em dash or en dash. Use a comma, a full stop or a plain hyphen.",
    "5. Keep to every length in the schema exactly: Google rejects a headline over 30 characters or a description over 90.",
    "",
    "CREATIVE DIRECTION (from the agency):",
    direction,
  ].join("\n");

  const user = [
    `Write ${count} image variants, plus the Google copy, for this business.`,
    "",
    "BRIEF (everything we know - do not add to it):",
    facts.length ? facts.map((f) => `  - ${f}`).join("\n") : "  - (No onboarding detail captured yet)",
    note ? `\nFOR THIS CLIENT SPECIFICALLY:\n${note}` : "",
    Array.isArray(meta.headlines) && meta.headlines.length
      ? `\nTheir Meta ad headlines, for consistency (do not just repeat them):\n${(meta.headlines as string[]).map((h) => `  - ${h}`).join("\n")}`
      : "",
  ].join("\n");

  let parsed: z.infer<typeof CreativeCopySchema> | null = null;
  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(CreativeCopySchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as Parameters<typeof client.messages.parse>[0]);
    if (res.stop_reason === "refusal") {
      return json({ error: `The model declined this request: ${res.stop_details?.explanation || "no reason given"}` }, 422);
    }
    parsed = res.parsed_output as z.infer<typeof CreativeCopySchema> | null;
  } catch (e) {
    const msg = (e as Error).message || "The request failed";
    console.error("write_creative_copy failed:", msg);
    return json({ error: `Creative copy failed: ${msg}` }, 502);
  }
  if (!parsed || !parsed.variants?.length) return json({ error: "The model returned no usable copy. Try again." }, 502);

  const record = {
    ...parsed,
    variants: parsed.variants.slice(0, count),
    generated_at: new Date().toISOString(),
    generated_by: ctx.actor.name,
  };
  const patch: Record<string, unknown> = { creative_copy: record };
  if ("creative_note" in b) patch.creative_note = note || null;
  const { error } = await ctx.admin.from("companies").update(patch).eq("id", ctx.companyId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, creative_copy: record });
}

// One finished image from the panel. `last` marks the end of a batch, which is
// when the checklist step moves - once, with the count, not per image.
async function saveCreative(ctx: Ctx, b: Record<string, unknown>) {
  let stored;
  try {
    stored = await storeImage(ctx, "creatives", b.data, String(b.content_type || "image/jpeg"));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  const label = String(b.label || "Creative").trim().slice(0, 300);
  const { error } = await ctx.admin.from("preview_links").insert({
    company_id: ctx.companyId, kind: "image", url: stored.url, label, created_by: ctx.actor.id,
  });
  if (error) return json({ error: error.message }, 500);
  if (b.last) {
    const n = Number(b.batch_count) || 1;
    await setStep(ctx, "creatives_generated", "done", `${n} creative${n === 1 ? "" : "s"} made in the creative studio`);
  }
  return json({ ok: true, url: stored.url });
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
