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
//   stock_*             the stock library (admins and ops managers): list,
//                       upload (straight to R2), retag, retire, delete.
//   use_stock           put stock items into a client's library; with
//                       auto: true, picks the best for their trade.
//   policy_check        Claude reads every line of the Meta copy, the image
//                       text and the Google copy against Meta's and Google's
//                       ad rules and Australian consumer law, rewrites what
//                       must change, and leaves the judgement calls flagged.
//
// The panel's "Build preview pack" button runs generate_ad_copy,
// write_creative_copy, policy_check and the drawing in one go.
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
// The autopilot (creative-rounds, on a schedule) calls generate_ad_copy,
// write_creative_copy, policy_check and use_stock for a client with the
// x-autopilot-secret header instead of a login; it acts as "Automation".
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
import { FALLBACK_BETA, MODEL } from "../_shared/claude.ts";
import { briefFacts } from "../_shared/brief.ts";
import { type Line, runPolicy, type Where } from "../_shared/ad-policy.ts";
import {
  deleteObject, headObject, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MEDIA_TYPES, mediaConfigured, uploadUrl, viewUrl,
} from "../_shared/r2.ts";
import { claimUpload, reserveUpload } from "../_shared/upload-ledger.ts";

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
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const body = await req.json().catch(() => ({}));
    const { action, company_id: companyId } = body as { action?: string; company_id?: string };

    // The autopilot: a fixed set of actions, as "Automation", for any client.
    const autopilotSecret = req.headers.get("x-autopilot-secret") || "";
    let caller: { id: string | null } | null = null;
    let isAdmin = false, isOps = false, actorName = "Automation";
    if (autopilotSecret) {
      const { data: ok } = await admin.rpc("autopilot_secret_ok", { p: autopilotSecret });
      if (ok !== true) return json({ error: "unauthorized" }, 401);
      if (!["generate_ad_copy", "write_creative_copy", "policy_check", "use_stock"].includes(String(action))) {
        return json({ error: "Not an autopilot action" }, 403);
      }
      caller = { id: null };
      isOps = true;
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const token = authHeader.replace(/^Bearer\s+/i, "");
      const { data: { user } } = await userClient.auth.getUser(token);
      if (!user) return json({ error: "Not authenticated" }, 401);
      const { data: me } = await admin
        .from("profiles").select("is_team, is_admin, full_name, team_role")
        .eq("id", user.id).maybeSingle();
      const isTeam = me?.is_team === true;
      isAdmin = me?.is_admin === true;
      isOps = isTeam && me?.team_role === "ops_manager";
      if (!isTeam && !isAdmin) return json({ error: "Forbidden: Internal Team access required" }, 403);
      caller = { id: user.id };
      actorName = (me?.full_name as string) || "Internal Team";
    }

    // The stock library belongs to no one client.
    if (action && action.startsWith("stock_")) {
      if (!(isAdmin || isOps)) return json({ error: "Only an admin or ops manager can change the stock library" }, 403);
      return await stockAction(admin, action, body as Record<string, unknown>, caller.id!);
    }
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
      .select("id, name, niche, service_area, plan, website_url, dfy_profile, generated_ad_copy, max_daily_ad_spend, brand_color, creative_note, creative_copy, client_testimonials, ad_policy_check, creative_source")
      .eq("id", companyId).maybeSingle();
    if (!company) return json({ error: "Client not found" }, 404);

    const ctx = { admin, companyId, company, actor: { id: caller.id, name: actorName }, isAdmin, isOps };

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
    if (action === "policy_check")           return await policyCheck(ctx, b);
    if (action === "use_stock")              return await useStock(ctx, b);

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
  actor: { id: string | null; name: string };
  isAdmin: boolean;
  isOps: boolean;
};

// ─── Step 4: ad copy ─────────────────────────────────────────────────────────
async function generateAdCopy(ctx: Ctx) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "ANTHROPIC_API_KEY is not set on this project, so ad copy cannot be generated yet." }, 503);
  }

  const facts = briefFacts(ctx.company);
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
      model: MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(AdCopySchema), effort: "high" },
      // Ad copy for a real client should not silently come back empty because a
      // classifier declined; on a decline the API re-runs on the fallback model
      // inside the same call.
      fallbacks: "default",
    } as Parameters<typeof client.messages.parse>[0], FALLBACK_BETA);

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
    model: MODEL,
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

const ASSET_COLS = "id, kind, url, path, storage, source, content_type, bytes, width, height, label, stock_asset_id, created_at";

// A browser-usable URL for a library item: R2 files are signed on the way out.
async function withUrl(a: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = a.storage === "r2" ? await viewUrl(a.path as string).catch(() => null) : a.url;
  const { path: _p, ...rest } = a;
  return { ...rest, url };
}

// Removing a library item: a file the client or team uploaded goes with it; a
// stock item only leaves this client's library.
async function dropAssets(ctx: Ctx, rows: Record<string, unknown>[]) {
  for (const o of rows) {
    if (o.source === "stock") continue;
    if (o.storage === "r2") await deleteObject(o.path as string);
    else await ctx.admin.storage.from(BUCKET).remove([o.path as string]);
  }
  if (rows.length) await ctx.admin.from("company_assets").delete().in("id", rows.map((o) => o.id as string));
}

async function creativeState(ctx: Ctx) {
  const [{ data: assets }, p] = await Promise.all([
    ctx.admin.from("company_assets").select(ASSET_COLS)
      .eq("company_id", ctx.companyId).order("created_at", { ascending: true }),
    creativePrompt(ctx),
  ]);
  return json({
    assets: await Promise.all(((assets ?? []) as Record<string, unknown>[]).map(withUrl)),
    creative_source: ctx.company.creative_source ?? null,
    trades: tradesOf(ctx.company),
    media_ready: mediaConfigured(),
    brand_color: ctx.company.brand_color ?? null,
    creative_note: ctx.company.creative_note ?? "",
    creative_copy: ctx.company.creative_copy ?? null,
    ad_policy_check: ctx.company.ad_policy_check ?? null,
    client_testimonials: ctx.company.client_testimonials ?? "",
    prompt: p.prompt,
    prompt_is_default: !p.custom,
    default_prompt: DEFAULT_CREATIVE_PROMPT,
    can_edit_prompt: ctx.isAdmin,
    can_manage_stock: ctx.isAdmin || ctx.isOps,
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
    const { data: old } = await ctx.admin.from("company_assets").select("id, path, storage, source")
      .eq("company_id", ctx.companyId).eq("kind", "logo");
    await dropAssets(ctx, (old ?? []) as Record<string, unknown>[]);
  }
  const dim = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
  const { data, error } = await ctx.admin.from("company_assets").insert({
    company_id: ctx.companyId, kind, url: stored.url, path: stored.path,
    width: dim(b.width), height: dim(b.height),
    label: String(b.filename || "").trim().slice(0, 200) || null,
    created_by: ctx.actor.id, source: "team",
  }).select(ASSET_COLS).single();
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, asset: await withUrl(data as Record<string, unknown>) });
}

async function deleteAsset(ctx: Ctx, b: Record<string, unknown>) {
  const { data: row } = await ctx.admin.from("company_assets").select("id, path, storage, source")
    .eq("id", String(b.asset_id || "")).eq("company_id", ctx.companyId).maybeSingle();
  if (!row) return json({ error: "No such asset for this client" }, 404);
  await dropAssets(ctx, [row as Record<string, unknown>]);
  return json({ ok: true });
}

// ─── The stock library ───────────────────────────────────────────────────────
// Photos and videos the team keeps for clients who have none of their own,
// tagged by trade. Files live in R2 under stock/; a client's library points at
// them (company_assets.source = 'stock') rather than copying them.

const TRADES = ["solar", "battery", "hvac", "renovations", "roofing", "painting", "other"] as const;

// Which trades a client is in, read from the free-text niche and what they
// told us in onboarding ("Solar, Battery Retrofit", "Solar/Aircon", ...).
function tradesOf(company: Record<string, unknown>): string[] {
  const profile = (company.dfy_profile || {}) as Record<string, unknown>;
  const text = `${company.niche ?? ""} ${profile.industry ?? ""}`.toLowerCase();
  const out = new Set<string>();
  if (/solar|pv\b/.test(text)) out.add("solar");
  if (/batter/.test(text)) out.add("battery");
  if (/hvac|air ?con|aircon|heat(ing)? pump|cooling|split system/.test(text)) out.add("hvac");
  if (/renovat|kitchen|bathroom|extension|builder|building/.test(text)) out.add("renovations");
  if (/roof|gutter/.test(text)) out.add("roofing");
  if (/paint/.test(text)) out.add("painting");
  if (!out.size) out.add("other");
  return [...out];
}

const STOCK_COLS = "id, trades, kind, path, content_type, width, height, bytes, label, active, created_at";

async function stockAction(admin: Ctx["admin"], action: string, b: Record<string, unknown>, userId: string) {
  const signed = async (r: Record<string, unknown>) => ({ ...r, url: await viewUrl(r.path as string).catch(() => null) });
  const cleanTrades = (v: unknown) => (Array.isArray(v) ? v : []).map(String).filter((t) => (TRADES as readonly string[]).includes(t));

  if (action === "stock_list") {
    const { data } = await admin.from("stock_assets").select(STOCK_COLS).order("created_at", { ascending: false });
    return json({ items: await Promise.all(((data ?? []) as Record<string, unknown>[]).map(signed)), trades: TRADES, media_ready: mediaConfigured() });
  }
  if (action === "stock_start_upload") {
    if (!mediaConfigured()) return json({ error: "Media storage (R2) isn't set up yet" }, 503);
    const type = MEDIA_TYPES[String(b.content_type || "")];
    const bytes = Number(b.bytes) || 0;
    if (!type) return json({ error: "Photos must be JPG, PNG or WebP, and videos MP4 or MOV" }, 400);
    const max = type.kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (bytes <= 0 || bytes > max) return json({ error: `Files can be up to ${Math.round(max / 1048576)} MB` }, 400);
    const key = `stock/${crypto.randomUUID()}.${type.ext}`;
    const contentType = String(b.content_type);
    const refused = await reserveUpload(admin, { key, companyId: null, kind: type.kind === "video" ? "video" : "photo", bytes, contentType, userId });
    if (refused) return json({ error: refused }, 429);
    return json({ ok: true, key, upload_url: await uploadUrl(key, contentType, bytes) });
  }
  if (action === "stock_finish_upload") {
    const key = String(b.key || "");
    if (!/^stock\/[0-9a-f-]{36}\.(jpg|png|webp|mp4|mov)$/.test(key)) return json({ error: "Unknown upload" }, 400);
    const ledger = await claimUpload(admin, key, null);
    if (!ledger) return json({ error: "Unknown upload" }, 400);
    const head = await headObject(key);
    if (!head) return json({ error: "The file didn't arrive. Try again." }, 400);
    const type = MEDIA_TYPES[head.contentType.split(";")[0]];
    if (!type || head.bytes !== Number(ledger.bytes)) { await deleteObject(key); return json({ error: "That file is the wrong type or size" }, 400); }
    const dim = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
    const { data, error } = await admin.from("stock_assets").insert({
      trades: cleanTrades(b.trades), kind: type.kind === "video" ? "video" : "photo", path: key,
      content_type: head.contentType || null, bytes: head.bytes, width: dim(b.width), height: dim(b.height),
      label: String(b.label || "").trim().slice(0, 200) || null, created_by: userId,
    }).select(STOCK_COLS).single();
    if (error) { await deleteObject(key); return json({ error: error.message }, 500); }
    return json({ ok: true, item: await signed(data as Record<string, unknown>) });
  }
  if (action === "stock_update") {
    const patch: Record<string, unknown> = {};
    if ("trades" in b) patch.trades = cleanTrades(b.trades);
    if ("active" in b) patch.active = b.active === true;
    if ("label" in b) patch.label = String(b.label || "").trim().slice(0, 200) || null;
    const { error } = await admin.from("stock_assets").update(patch).eq("id", String(b.id || ""));
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }
  if (action === "stock_delete") {
    // Also leaves every client library it was in (on delete cascade).
    const { data: row } = await admin.from("stock_assets").select("id, path").eq("id", String(b.id || "")).maybeSingle();
    if (!row) return json({ error: "No such stock item" }, 404);
    await deleteObject(row.path as string);
    await admin.from("stock_assets").delete().eq("id", row.id);
    return json({ ok: true });
  }
  return json({ error: `Unknown action: ${action}` }, 400);
}

// Stock into one client's library: the items named, or with auto: true the
// best matches for their trade that they don't already have.
async function useStock(ctx: Ctx, b: Record<string, unknown>) {
  const { data: have } = await ctx.admin.from("company_assets").select("stock_asset_id")
    .eq("company_id", ctx.companyId).not("stock_asset_id", "is", null);
  const already = new Set(((have ?? []) as Record<string, unknown>[]).map((r) => r.stock_asset_id as string));
  let picks: Record<string, unknown>[] = [];
  if (b.auto === true) {
    const trades = tradesOf(ctx.company);
    const { data } = await ctx.admin.from("stock_assets").select(STOCK_COLS)
      .eq("active", true).overlaps("trades", trades).order("created_at", { ascending: false }).limit(100);
    const fresh = ((data ?? []) as Record<string, unknown>[]).filter((r) => !already.has(r.id as string));
    const photos = Math.min(Math.max(Number(b.photos) || 6, 0), 20);
    const videos = Math.min(Math.max(Number(b.videos) || 2, 0), 10);
    picks = [...fresh.filter((r) => r.kind === "photo").slice(0, photos), ...fresh.filter((r) => r.kind === "video").slice(0, videos)];
  } else {
    const ids = (Array.isArray(b.stock_ids) ? b.stock_ids : []).map(String).filter((id) => !already.has(id)).slice(0, 40);
    if (ids.length) {
      const { data } = await ctx.admin.from("stock_assets").select(STOCK_COLS).in("id", ids).eq("active", true);
      picks = (data ?? []) as Record<string, unknown>[];
    }
  }
  if (!picks.length) return json({ ok: true, added: [] });
  const { data, error } = await ctx.admin.from("company_assets").insert(picks.map((r) => ({
    company_id: ctx.companyId, kind: r.kind, url: null, path: r.path, storage: "r2", source: "stock",
    stock_asset_id: r.id, content_type: r.content_type, bytes: r.bytes, width: r.width, height: r.height,
    label: r.label, created_by: ctx.actor.id,
  }))).select(ASSET_COLS);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, added: await Promise.all(((data ?? []) as Record<string, unknown>[]).map(withUrl)) });
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
  const facts = briefFacts(ctx.company);
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
      model: MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(CreativeCopySchema), effort: "high" },
      fallbacks: "default",
    } as Parameters<typeof client.messages.parse>[0], FALLBACK_BETA);
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
    const extra = String(b.note || "").trim().slice(0, 500);
    await setStep(ctx, "creatives_generated", "done",
      `${n} creative${n === 1 ? "" : "s"} made in the creative studio${extra ? `. ${extra}` : ""}`);
  }
  return json({ ok: true, url: stored.url });
}

// ─── The ad-rules check ──────────────────────────────────────────────────────
// The check itself lives in _shared/ad-policy.ts, shared with the preview
// rounds (creative-rounds).

// The studio's copy as numbered lines, in the order the client will see it.
function copyLines(ctx: Ctx): Line[] {
  const meta = (ctx.company.generated_ad_copy || {}) as Record<string, unknown>;
  const cc = (ctx.company.creative_copy || {}) as Record<string, unknown>;
  const g = (cc.google || {}) as Record<string, unknown>;
  const out: Line[] = [];
  const list = (where: Where, v: unknown) =>
    (Array.isArray(v) ? v : []).forEach((t, i) => { if (typeof t === "string" && t.trim()) out.push({ where, index: i, text: t }); });
  list("meta_headline", meta.headlines);
  list("meta_primary_text", meta.primary_texts);
  list("meta_description", meta.descriptions);
  ((cc.variants || []) as Record<string, unknown>[]).forEach((v, i) => {
    for (const [k, where] of [["headline", "image_headline"], ["subline", "image_subline"], ["cta", "image_cta"]] as const) {
      if (typeof v[k] === "string" && (v[k] as string).trim()) out.push({ where, index: i, text: v[k] as string });
    }
  });
  list("google_headline", g.headlines);
  if (typeof g.long_headline === "string" && g.long_headline.trim()) out.push({ where: "google_long_headline", index: 0, text: g.long_headline });
  list("google_description", g.descriptions);
  return out;
}

function setLine(meta: Record<string, unknown>, cc: Record<string, unknown>, where: Where, index: number, text: string) {
  const at = (arr: unknown) => { if (Array.isArray(arr) && index < arr.length) arr[index] = text; };
  const g = (cc.google || {}) as Record<string, unknown>;
  switch (where) {
    case "meta_headline": return at(meta.headlines);
    case "meta_primary_text": return at(meta.primary_texts);
    case "meta_description": return at(meta.descriptions);
    case "google_headline": return at(g.headlines);
    case "google_description": return at(g.descriptions);
    case "google_long_headline": g.long_headline = text; return;
    default: {
      const v = ((cc.variants || []) as Record<string, unknown>[])[index];
      if (v) v[where.replace("image_", "")] = text;
    }
  }
}

// The ad rules check (_shared/ad-policy.ts) over the studio's copy, with what
// must change rewritten in place. The result is kept on the company so the
// studio shows it after a reload.
async function policyCheck(ctx: Ctx, b: Record<string, unknown>) {
  const lines = copyLines(ctx);
  if (!lines.length) return json({ error: "There is no copy to check yet. Write the ad copy and the image copy first." }, 400);
  let result;
  try {
    result = await runPolicy(ctx.company, lines, { apply: b.apply !== false, actor: ctx.actor.name });
  } catch (e) {
    const msg = (e as Error).message || "The request failed";
    console.error("policy_check failed:", msg);
    return json({ error: `The ad rules check failed: ${msg}` }, 502);
  }
  const meta = structuredClone(ctx.company.generated_ad_copy || {}) as Record<string, unknown>;
  const cc = structuredClone(ctx.company.creative_copy || {}) as Record<string, unknown>;
  for (const [key, text] of result.rewrites) {
    const [where, index] = key.split(":");
    setLine(meta, cc, where as Where, Number(index), text);
  }
  const patch: Record<string, unknown> = { ad_policy_check: result.record };
  if (result.rewrites.size) {
    if (ctx.company.generated_ad_copy) patch.generated_ad_copy = meta;
    if (ctx.company.creative_copy) patch.creative_copy = cc;
  }
  const { error } = await ctx.admin.from("companies").update(patch).eq("id", ctx.companyId);
  if (error) return json({ error: error.message }, 500);
  return json({
    ok: true, ad_policy_check: result.record,
    creative_copy: patch.creative_copy ?? ctx.company.creative_copy ?? null,
    ad_copy: patch.generated_ad_copy ?? ctx.company.generated_ad_copy ?? null,
  });
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
