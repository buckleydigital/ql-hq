// =============================================================================
// creative-rounds - preview rounds: build, review, send, revise
// =============================================================================
// A round is one set of ads the client sees (see _shared/rounds.ts for what an
// ad holds). The life of one:
//
//   building     the autopilot writes it (stock, Meta copy, image copy, the
//                ad rules check), or revises the last one from the client's
//                comments and checks it again
//   drawing      copy final; the Team Panel draws the images (a browser does
//                this in a moment; an edge function can't)
//   team_review  the images and videos are in the client's ad account, and
//                the team sees Meta's own previews; edits, then sends
//   preparing    sent, but Meta is still processing a video: goes out on its
//                own when ready
//   sent         with the client (creative-approval); then approved, or
//                changes_requested, which starts the next round
//
// The client never sees anything before the team sends it, and never sees the
// machinery: a comment goes in, and later an email says their updated ads are
// ready. After three rounds without approval, a person takes over.
//
// Team actions (team login, same scope rules as fulfilment-ai): state, start,
// attach, finish, previews, edit_ad, send, discard.
// { action: "autopilot" } with x-autopilot-secret: pg_cron, every 5 minutes.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0";
import { z } from "npm:zod@4";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0/helpers/zod";
import { FALLBACK_BETA, MODEL } from "../_shared/claude.ts";
import { briefText } from "../_shared/brief.ts";
import { runPolicy, type Where } from "../_shared/ad-policy.ts";
import { uploadImage, uploadVideo, videoState } from "../_shared/meta-ads.ts";
import { viewUrl } from "../_shared/r2.ts";
import { type Ad, metaIds, roundLines, roundPreviews, setRoundLine } from "../_shared/rounds.ts";
import { clientContact, clientHtml, opsEmail, sendEmail, setStep, SITE } from "../_shared/notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BUCKET = "preview-images";
const MAX_SENT_ROUNDS = 3;
// The autopilot writes three image ads; a pack built by hand takes the
// studio's variant count, up to six.
const IMAGE_ADS = 3;
const MAX_IMAGE_ADS = 6;
const VIDEO_ADS = 2;
const OPEN = ["building", "drawing", "team_review", "preparing"];

type Admin = ReturnType<typeof createClient>;
type Row = Record<string, unknown>;
type Actor = { id: string | null; name: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({})) as Row;

    const secret = req.headers.get("x-autopilot-secret") || "";
    if (secret) {
      const { data: ok } = await admin.rpc("autopilot_secret_ok", { p: secret });
      if (ok !== true || body.action !== "autopilot") return json({ error: "unauthorized" }, 401);
      return json(await autopilot(admin, secret));
    }

    // A team member, scoped as in fulfilment-ai.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated" }, 401);
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Not authenticated" }, 401);
    const { data: me } = await admin.from("profiles").select("is_team, is_admin, full_name, team_role").eq("id", user.id).maybeSingle();
    const isTeam = me?.is_team === true, isAdmin = me?.is_admin === true;
    const isOps = isTeam && me?.team_role === "ops_manager";
    if (!isTeam && !isAdmin) return json({ error: "Forbidden: Internal Team access required" }, 403);
    const companyId = String(body.company_id || "");
    if (!companyId) return json({ error: "company_id is required" }, 400);
    if (!(isAdmin || isOps)) {
      const { data: assigned } = await admin.from("team_assignments").select("company_id")
        .eq("team_user_id", user.id).eq("company_id", companyId).maybeSingle();
      if (!assigned) return json({ error: "Forbidden: client not assigned to you" }, 403);
    }
    const company = await loadCompany(admin, companyId);
    if (!company) return json({ error: "Client not found" }, 404);
    const actor: Actor = { id: user.id, name: (me?.full_name as string) || "Internal Team" };

    switch (body.action) {
      case "state":    return json(await state(admin, company));
      case "start":    return await start(admin, company, actor);
      case "attach":   return await attach(admin, company, body);
      case "finish":   return await finish(admin, company, body);
      case "previews": return await previews(admin, company, body);
      case "edit_ad":  return await editAd(admin, company, body);
      case "send":     return await send(admin, company, body, actor);
      case "discard":  return await discard(admin, company, body);
    }
    return json({ error: `Unknown action: ${body.action}` }, 400);
  } catch (err) {
    console.error("creative-rounds error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});

const COMPANY_COLS = "id, name, plan, niche, service_area, website_url, dfy_profile, generated_ad_copy, creative_copy, creative_note, creative_source, client_testimonials, max_daily_ad_spend, approval_token, ad_policy_check";

async function loadCompany(admin: Admin, id: string): Promise<Row | null> {
  const { data } = await admin.from("companies").select(COMPANY_COLS).eq("id", id).maybeSingle();
  return (data as Row | null) ?? null;
}

async function loadRound(admin: Admin, company: Row, roundId: unknown): Promise<Row | null> {
  const { data } = await admin.from("creative_rounds").select("*").eq("id", String(roundId || "")).eq("company_id", company.id).maybeSingle();
  return (data as Row | null) ?? null;
}

const nextRoundNumber = async (admin: Admin, companyId: string) => {
  const { data } = await admin.from("creative_rounds").select("round").eq("company_id", companyId).order("round", { ascending: false }).limit(1).maybeSingle();
  return Number((data as Row | null)?.round || 0) + 1;
};

const sentCount = async (admin: Admin, companyId: string) => {
  const { count } = await admin.from("creative_rounds").select("id", { count: "exact", head: true })
    .eq("company_id", companyId).not("sent_at", "is", null);
  return count ?? 0;
};

async function ensureToken(admin: Admin, company: Row): Promise<string> {
  if (company.approval_token) return String(company.approval_token);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  await admin.from("companies").update({ approval_token: token }).eq("id", company.id);
  company.approval_token = token;
  return token;
}

const approvalUrl = (token: string) => `${SITE}/approve.html?t=${token}`;

// ─── Composing a round from the studio's copy ────────────────────────────────
// Ad n pairs image variant n (the words on the image) with the nth Meta
// primary text, headline and description, on the nth photo; then up to
// VIDEO_ADS of the client's videos carry the copy that's left.
async function composeAds(admin: Admin, company: Row): Promise<Ad[]> {
  const meta = (company.generated_ad_copy || {}) as Record<string, string[]>;
  const variants = (((company.creative_copy || {}) as Row).variants || []) as { headline?: string; subline?: string; cta?: string }[];
  if (!variants.length || !meta.headlines?.length) throw new Error("Write the Meta copy and the image copy first");
  const { data: lib } = await admin.from("company_assets").select("id, kind").eq("company_id", company.id).order("created_at", { ascending: true });
  const photos = ((lib ?? []) as Row[]).filter((a) => a.kind === "photo");
  const videos = ((lib ?? []) as Row[]).filter((a) => a.kind === "video").slice(0, VIDEO_ADS);
  const pick = (arr: string[] | undefined, i: number) => (arr?.length ? arr[i % arr.length] : "");
  const copy = (i: number) => ({ message: pick(meta.primary_texts, i), headline: pick(meta.headlines, i), description: pick(meta.descriptions, i) });
  const ads: Ad[] = variants.slice(0, MAX_IMAGE_ADS).map((v, i) => ({
    key: `a${i + 1}`, kind: "image",
    image_text: { headline: v.headline || "", subline: v.subline || "", cta: v.cta || "" },
    ...copy(i),
    photo_asset_id: photos.length ? String(photos[i % photos.length].id) : null,
    feed_url: null, story_url: null, meta: {},
  }));
  videos.forEach((v, j) => ads.push({ key: `v${j + 1}`, kind: "video", ...copy(ads.length), video_asset_id: String(v.id), meta: {} }));
  return ads;
}

/** Retire every round still being worked on, so only one is ever open. */
async function closeOpenRounds(admin: Admin, companyId: string) {
  await admin.from("creative_rounds").update({ status: "superseded" }).eq("company_id", companyId).in("status", OPEN);
}

// ─── Team actions ────────────────────────────────────────────────────────────
async function state(admin: Admin, company: Row) {
  const { data } = await admin.from("creative_rounds")
    .select("id, round, status, build_stage, ads, policy, changes, feedback, error, created_at, sent_at, sent_by_name, decided_at")
    .eq("company_id", company.id).neq("status", "superseded").order("round", { ascending: false }).limit(12);
  return {
    rounds: data ?? [],
    meta_ready: !!metaIds(company),
    approval_url: company.approval_token ? approvalUrl(String(company.approval_token)) : null,
  };
}

async function start(admin: Admin, company: Row, actor: Actor) {
  let ads: Ad[];
  try { ads = await composeAds(admin, company); } catch (e) { return json({ error: (e as Error).message }, 400); }
  await closeOpenRounds(admin, String(company.id));
  const { data, error } = await admin.from("creative_rounds").insert({
    company_id: company.id, round: await nextRoundNumber(admin, String(company.id)), status: "drawing", ads,
    policy: (company.ad_policy_check as Row) ?? null,
    changes: { team: `Built in the studio by ${actor.name}` },
  }).select("*").single();
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, round: data });
}

/** One drawn image (feed 4:5 or story 9:16) for one ad, from the panel. */
async function attach(admin: Admin, company: Row, b: Row) {
  const round = await loadRound(admin, company, b.round_id);
  if (!round || round.status !== "drawing") return json({ error: "That round isn't waiting for images" }, 400);
  const shape = b.shape === "story" ? "story" : "feed";
  const ads = round.ads as Ad[];
  const ad = ads.find((a) => a.key === b.ad_key && a.kind === "image");
  if (!ad) return json({ error: "No such ad in this round" }, 400);
  const raw = String(b.data || "");
  let bytes: Uint8Array;
  try {
    const bin = atob(raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw);
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch { return json({ error: "Invalid image data" }, 400); }
  if (bytes.length > 10 * 1024 * 1024) return json({ error: "Image exceeds 10 MB" }, 400);
  const path = `${company.id}/rounds/${round.id}/${ad.key}-${shape}-${crypto.randomUUID().slice(0, 8)}.jpg`;
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (error) return json({ error: error.message }, 500);
  ad[`${shape}_url`] = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  await admin.from("creative_rounds").update({ ads }).eq("id", round.id);
  return json({ ok: true });
}

/** Put the round's images and videos into the client's ad account; ready for review. */
async function finish(admin: Admin, company: Row, b: Row) {
  const round = await loadRound(admin, company, b.round_id);
  if (!round || round.status !== "drawing") return json({ error: "That round isn't waiting to be finished" }, 400);
  const ids = metaIds(company);
  if (!ids) return json({ error: "Connect the client's ad account and Facebook Page first (the access step)" }, 400);
  const ads = round.ads as Ad[];
  const missing = ads.filter((a) => a.kind === "image" && !a.feed_url).map((a) => a.key);
  if (missing.length) return json({ error: `Images still missing for ${missing.join(", ")}` }, 400);
  try {
    for (const ad of ads) {
      ad.meta = ad.meta || {};
      if (ad.kind === "image") {
        ad.meta.feed_hash = await uploadImage(ids.account, ad.feed_url!);
        ad.meta.story_hash = ad.story_url ? await uploadImage(ids.account, ad.story_url) : undefined;
      } else if (!ad.meta.video_id) {
        const { data: v } = await admin.from("company_assets").select("path, storage, url, label").eq("id", ad.video_asset_id).maybeSingle();
        if (!v) continue;
        const fileUrl = v.storage === "r2" ? await viewUrl(v.path as string) : String(v.url);
        ad.meta.video_id = await uploadVideo(ids.account, fileUrl, String(v.label || `${company.name} video`));
      }
    }
  } catch (e) {
    await admin.from("creative_rounds").update({ ads, error: (e as Error).message }).eq("id", round.id);
    return json({ error: (e as Error).message }, 502);
  }
  await admin.from("creative_rounds").update({ ads, status: "team_review", previews: null, error: null }).eq("id", round.id);
  return json({ ok: true });
}

/** Ask Meta how far it is with each video; true when none are still processing. */
async function refreshVideos(admin: Admin, round: Row): Promise<boolean> {
  const ads = round.ads as Ad[];
  let changed = false, waiting = false;
  for (const ad of ads) {
    const m = ad.meta || {};
    if (ad.kind !== "video" || !m.video_id || m.video_ready || m.video_failed) continue;
    try {
      const s = await videoState(m.video_id);
      if (s.ready) { m.video_ready = true; m.thumbnail = s.thumbnail || undefined; changed = true; }
      else if (s.failed) { m.video_failed = true; changed = true; }
      else waiting = true;
    } catch { waiting = true; }
    ad.meta = m;
  }
  if (changed) await admin.from("creative_rounds").update({ ads }).eq("id", round.id);
  return !waiting;
}

async function previews(admin: Admin, company: Row, b: Row) {
  const round = await loadRound(admin, company, b.round_id);
  if (!round) return json({ error: "No such round" }, 404);
  await refreshVideos(admin, round);
  try {
    return json({ ok: true, ads: await roundPreviews(admin, round, company, { refresh: b.refresh === true }) });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}

/** The team's tweaks to the words around the image, before it goes out. */
async function editAd(admin: Admin, company: Row, b: Row) {
  const round = await loadRound(admin, company, b.round_id);
  if (!round || round.status !== "team_review") return json({ error: "Only a round in review can be edited" }, 400);
  const ads = round.ads as Ad[];
  const ad = ads.find((a) => a.key === b.ad_key);
  if (!ad) return json({ error: "No such ad" }, 400);
  for (const k of ["message", "headline", "description"] as const) {
    if (typeof b[k] === "string") ad[k] = String(b[k]).trim().slice(0, k === "message" ? 600 : k === "headline" ? 40 : 200);
  }
  const prev = (round.previews || {}) as { at?: string; items?: Record<string, unknown> };
  if (prev.items) delete prev.items[ad.key];
  await admin.from("creative_rounds").update({ ads, previews: prev }).eq("id", round.id);
  return json({ ok: true });
}

async function send(admin: Admin, company: Row, b: Row, actor: Actor) {
  const round = await loadRound(admin, company, b.round_id);
  if (!round || round.status !== "team_review") return json({ error: "Only a round in review can be sent" }, 400);
  const ready = await refreshVideos(admin, round);
  await admin.from("creative_rounds").update({ sent_by_name: actor.name }).eq("id", round.id);
  if (!ready) {
    await admin.from("creative_rounds").update({ status: "preparing" }).eq("id", round.id);
    return json({ ok: true, status: "preparing" });
  }
  await deliver(admin, company, { ...round, sent_by_name: actor.name });
  return json({ ok: true, status: "sent" });
}

async function discard(admin: Admin, company: Row, b: Row) {
  const round = await loadRound(admin, company, b.round_id);
  if (!round || !OPEN.includes(String(round.status))) return json({ error: "Only a round not yet sent can be discarded" }, 400);
  await admin.from("creative_rounds").update({ status: "superseded" }).eq("id", round.id);
  return json({ ok: true });
}

/** To the client: the round goes live on their page and they get an email. */
async function deliver(admin: Admin, company: Row, round: Row) {
  const token = await ensureToken(admin, company);
  // A round the client hadn't answered yet is replaced by this one.
  await admin.from("creative_rounds").update({ status: "superseded" })
    .eq("company_id", company.id).eq("status", "sent").neq("id", round.id);
  await admin.from("creative_rounds").update({ status: "sent", sent_at: new Date().toISOString(), reminders: {} }).eq("id", round.id);
  const first = (await sentCount(admin, String(company.id))) <= 1;
  const { to, first: name } = await clientContact(admin, String(company.id));
  if (to) {
    const note = ((round.changes || {}) as Row).client as string | undefined;
    await sendEmail(to,
      first ? "Your ads are ready to look over" : "We've updated your ads",
      clientHtml(name, first
        ? ["Your ads are ready. We've put them together from what you told us, and you can see exactly how each one will appear on Facebook and Instagram.",
          "Have a look and let us know if you'd like anything changed. If they look good, approve them and we'll get your campaign ready to go live."]
        : [note || "We've made the changes you asked for.", "Have a look at the updated versions, exactly as they'll appear on Facebook and Instagram."],
      { label: "View your ads", url: approvalUrl(token) }));
  }
  await setStep(admin, String(company.id), "previews_sent", "done",
    `Round ${round.round} sent${to ? ` to ${to}` : " (no email on file: send the link by hand)"}`,
    { id: null, name: String(round.sent_by_name || "Automation") });
}

// ─── The autopilot ───────────────────────────────────────────────────────────
// One unit of work at a time, oldest first, until about a minute has gone:
// a single Claude call can take most of that, and a function is stopped at
// 150 seconds.
async function autopilot(admin: Admin, secret: string) {
  const started = Date.now();
  const done: string[] = [];
  const skip = new Set<string>();
  while (Date.now() - started < 60_000) {
    const unit = await nextUnit(admin, secret, skip);
    if (!unit) break;
    done.push(unit);
  }
  return { ok: true, done };
}

async function nextUnit(admin: Admin, secret: string, skip: Set<string>): Promise<string | null> {
  // 1. Sent by the team, waiting on Meta to finish a video.
  const { data: preparing } = await admin.from("creative_rounds").select("*").eq("status", "preparing").order("created_at").limit(10);
  for (const r of (preparing ?? []) as Row[]) {
    if (skip.has(String(r.id))) continue;
    skip.add(String(r.id));
    if (!(await refreshVideos(admin, r))) continue;
    const company = await loadCompany(admin, String(r.company_id));
    if (company) await deliver(admin, company, r);
    return `sent ${r.id} once its videos were ready`;
  }

  // 2. Chase answers.
  const chased = await remind(admin);
  if (chased) return chased;

  // 3. The client asked for changes: revise, or hand over after enough rounds.
  const { data: asked } = await admin.from("creative_rounds").select("*").eq("status", "changes_requested").order("decided_at").limit(20);
  for (const r of (asked ?? []) as Row[]) {
    const key = `asked:${r.id}`;
    if (skip.has(key) || ((r.reminders || {}) as Row).followed_up) continue;
    skip.add(key);
    const { count: newer } = await admin.from("creative_rounds").select("id", { count: "exact", head: true })
      .eq("company_id", r.company_id).gt("round", r.round).neq("status", "superseded");
    if (newer) continue;
    const company = await loadCompany(admin, String(r.company_id));
    if (!company) continue;
    await admin.from("creative_rounds").update({ reminders: { ...((r.reminders || {}) as Row), followed_up: true } }).eq("id", r.id);
    if (await sentCount(admin, String(company.id)) >= MAX_SENT_ROUNDS) {
      await setStep(admin, String(company.id), "previews_accepted", "blocked",
        `${MAX_SENT_ROUNDS} rounds without approval. Call them to talk it through.`, { id: null, name: "Automation" });
      await opsEmail(`🔴 ${company.name} still isn't happy after ${MAX_SENT_ROUNDS} rounds`,
        `<p><strong>${company.name}</strong> asked for changes again. That's ${MAX_SENT_ROUNDS} rounds, so the autopilot has stopped revising.</p>` +
        `<p>Their comments:</p>${feedbackHtml(r)}<p>Give them a call, then build the next round in the creative studio.</p>`);
      return `handed ${company.name} to the team`;
    }
    await admin.from("creative_rounds").insert({
      company_id: company.id, round: await nextRoundNumber(admin, String(company.id)), status: "building", build_stage: "revise",
      ads: r.ads, changes: { from_round: r.id },
    });
    return `started revising ${company.name}`;
  }

  // 4. A round being built: one stage.
  const { data: building } = await admin.from("creative_rounds").select("*").eq("status", "building").order("created_at").limit(10);
  for (const r of (building ?? []) as Row[]) {
    if (skip.has(String(r.id))) continue;
    skip.add(String(r.id));
    try {
      return await buildStage(admin, secret, r);
    } catch (e) {
      const msg = (e as Error).message;
      const attempts = Number(((r.reminders || {}) as Row).attempts || 0) + 1;
      await admin.from("creative_rounds").update({ error: msg, reminders: { ...((r.reminders || {}) as Row), attempts } }).eq("id", r.id);
      if (attempts >= 3) {
        await admin.from("creative_rounds").update({ status: "superseded" }).eq("id", r.id);
        const company = await loadCompany(admin, String(r.company_id));
        await opsEmail(`⚠️ Couldn't build ads for ${company?.name ?? "a client"}`,
          `<p>The autopilot tried ${attempts} times to ${r.build_stage === "revise" || r.build_stage === "recheck" ? "revise" : "build"} their ads and failed at "${r.build_stage}": ${msg}</p>` +
          `<p>Build the pack in their creative studio instead.</p>`);
      }
      return `failed ${r.id} at ${r.build_stage}: ${msg}`;
    }
  }

  // 5. New clients: Meta access and their media are both in, and no round yet.
  return await autoStart(admin);
}

async function callAi(secret: string, action: string, companyId: string, extra: Row = {}) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/fulfilment-ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-autopilot-secret": secret },
    body: JSON.stringify({ action, company_id: companyId, ...extra }),
  });
  const data = await res.json().catch(() => ({})) as Row;
  if (!res.ok) throw new Error(String(data.error || `${action} failed (HTTP ${res.status})`));
  return data;
}

async function buildStage(admin: Admin, secret: string, r: Row): Promise<string> {
  const companyId = String(r.company_id);
  const company = await loadCompany(admin, companyId);
  if (!company) throw new Error("client not found");
  const stage = String(r.build_stage || "stock");
  const advance = (build_stage: string) => admin.from("creative_rounds").update({ build_stage, error: null }).eq("id", r.id);

  if (stage === "stock") {
    const { count } = await admin.from("company_assets").select("id", { count: "exact", head: true })
      .eq("company_id", companyId).eq("kind", "photo");
    if (company.creative_source === "stock" || !count) await callAi(secret, "use_stock", companyId, { auto: true });
    await advance("ad_copy");
    return `${company.name}: stock`;
  }
  if (stage === "ad_copy") {
    await callAi(secret, "generate_ad_copy", companyId);
    await advance("image_copy");
    return `${company.name}: Meta copy`;
  }
  if (stage === "image_copy") {
    await callAi(secret, "write_creative_copy", companyId, { count: IMAGE_ADS });
    await advance("check");
    return `${company.name}: image copy`;
  }
  if (stage === "check") {
    const out = await callAi(secret, "policy_check", companyId, { apply: true });
    const fresh = await loadCompany(admin, companyId);
    const ads = await composeAds(admin, fresh!);
    await admin.from("creative_rounds").update({
      status: "drawing", build_stage: null, ads, policy: out.ad_policy_check ?? null, error: null,
      changes: { team: "First pack, built automatically" },
    }).eq("id", r.id);
    await tellTeamToDraw(company, Number(r.round), out.ad_policy_check as Row, null);
    return `${company.name}: ready to draw`;
  }
  if (stage === "revise") {
    const prev = r.changes && ((r.changes as Row).from_round as string);
    const { data: last } = prev ? await admin.from("creative_rounds").select("*").eq("id", prev).maybeSingle() : { data: null };
    if (!last) throw new Error("the round being revised is gone");
    const revised = await revise(admin, company, last as Row);
    await admin.from("creative_rounds").update({ ads: revised.ads, changes: { ...(r.changes as Row), ...revised.changes }, build_stage: "recheck", error: null }).eq("id", r.id);
    return `${company.name}: revised`;
  }
  if (stage === "recheck") {
    const ads = structuredClone(r.ads) as Ad[];
    const result = await runPolicy(company, roundLines(ads), { apply: true, actor: "Automation" });
    for (const [key, text] of result.rewrites) {
      const [where, index] = key.split(":");
      setRoundLine(ads, where as Where, Number(index), text);
    }
    await admin.from("creative_rounds").update({ ads, policy: result.record, status: "drawing", build_stage: null, error: null }).eq("id", r.id);
    await tellTeamToDraw(company, Number(r.round), result.record, (r.changes || {}) as Row);
    return `${company.name}: revision checked`;
  }
  throw new Error(`unknown stage ${stage}`);
}

async function tellTeamToDraw(company: Row, round: number, policy: Row | null, changes: Row | null) {
  const open = Number(policy?.must_fix_open || 0), check = Number(policy?.to_check || 0);
  await opsEmail(`🎨 ${company.name}: round ${round} ready to finish`,
    `<p>${changes ? `<strong>${company.name}</strong> asked for changes, and the revision is written and checked.` : `<strong>${company.name}</strong>'s first pack is written and checked.`}</p>` +
    (changes?.team ? `<p><strong>What changed:</strong> ${changes.team}</p>` : "") +
    (changes?.needs_person ? `<p style="color:#b42318"><strong>Needs a person:</strong> ${changes.needs_person}</p>` : "") +
    `<p>Ad rules check: ${open ? `<strong style="color:#b42318">${open} line${open === 1 ? "" : "s"} still must change</strong>` : "nothing that must change"}${check ? `, ${check} to look at` : ""}.</p>` +
    `<p>Open their creative studio in the Team Panel and press <strong>Finish pack</strong> to draw the images, check Meta's previews, then send.</p>`);
}

function feedbackHtml(r: Row): string {
  const fb = (r.feedback || {}) as { ads?: Record<string, { decision?: string; comment?: string }>; general?: string };
  const rows = Object.entries(fb.ads || {}).filter(([, v]) => v.decision === "change")
    .map(([k, v]) => `<li><strong>Ad ${k}</strong>: ${String(v.comment || "").replace(/</g, "&lt;")}</li>`);
  return `<ul>${rows.join("")}${fb.general ? `<li><strong>Overall</strong>: ${String(fb.general).replace(/</g, "&lt;")}</li>` : ""}</ul>`;
}

// The revision: the client's comments, the brief and the photo library in;
// every ad back, changed where asked, in the house rules. The client never
// sees this happen, only the result once the team has sent it.
const RevisionSchema = z.object({
  ads: z.array(z.object({
    key: z.string(),
    image_headline: z.string().describe("Words on the image: 3 to 7 words, under 45 characters"),
    image_subline: z.string().describe("Supporting line on the image, under 70 characters"),
    image_cta: z.string().describe("Button on the image, 2 to 4 words, under 22 characters"),
    message: z.string().describe("Meta primary text, 2 to 4 short sentences"),
    headline: z.string().describe("Meta headline, under 40 characters"),
    description: z.string().describe("Meta link description, under 30 words"),
    photo_id: z.string().describe("A photo id from the library to use instead, or empty to keep the current photo"),
  })),
  client_note: z.string().describe("One or two warm sentences to the client on what we changed, as 'we' (the QuoteLeads team). Never mention AI, automation or rounds."),
  team_note: z.string().describe("What changed and why, for the team, briefly"),
  needs_person: z.string().describe("Anything asked for that couldn't or shouldn't be done (a photo we don't have, an unsupported claim). Empty if none."),
});

async function revise(admin: Admin, company: Row, last: Row): Promise<{ ads: Ad[]; changes: Row }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const prevAds = last.ads as Ad[];
  const fb = (last.feedback || {}) as { ads?: Record<string, { decision?: string; comment?: string }>; general?: string };

  // The photos they could use, so a request like "use the one of the roof" can be met.
  const { data: lib } = await admin.from("company_assets").select("id, kind, url, path, storage, label, source")
    .eq("company_id", company.id).eq("kind", "photo").order("created_at", { ascending: true }).limit(12);
  const photos = await Promise.all(((lib ?? []) as Row[]).map(async (p) => ({
    id: String(p.id), label: String(p.label || ""), source: String(p.source),
    url: p.storage === "r2" ? await viewUrl(String(p.path)).catch(() => null) : String(p.url || ""),
  })));

  const content: Anthropic.ContentBlockParam[] = [];
  photos.filter((p) => p.url).forEach((p) => {
    content.push({ type: "text", text: `Photo id ${p.id} (${p.source}${p.label ? `, "${p.label}"` : ""}):` });
    content.push({ type: "image", source: { type: "url", url: p.url! } });
  });
  content.push({
    type: "text",
    text: [
      "BRIEF (everything we know; anything not here is unsupported):",
      briefText(company),
      "",
      "THE ADS THE CLIENT SAW (JSON):",
      JSON.stringify(prevAds.map((a) => ({
        key: a.key, kind: a.kind, photo_id: a.photo_asset_id || "", image_text: a.image_text || null,
        message: a.message, headline: a.headline, description: a.description,
      })), null, 1),
      "",
      "WHAT THE CLIENT SAID:",
      ...prevAds.map((a) => {
        const d = fb.ads?.[a.key];
        return `  - ${a.key}: ${d?.decision === "change" ? `change: ${d.comment || "(no detail)"}` : "looks good"}`;
      }),
      fb.general ? `  - Overall: ${fb.general}` : "",
      "",
      "Return every ad, in the same order with the same keys. Change what they asked for, and what their overall comment applies to; leave ads they were happy with as they are unless the overall comment covers them. For a video ad, the image_* fields are ignored: return them empty.",
    ].join("\n"),
  });

  const client = new Anthropic({ apiKey });
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: [
      "You revise Meta lead generation ads for an Australian home services business after the client's feedback. You write as the agency's creative team.",
      "",
      "Rules, in order of importance:",
      "1. Never invent a fact. No prices, discounts, rebates, guarantees, timeframes, ratings, review counts, years in business or accreditations unless they appear in the brief. If the client asks for a claim the brief doesn't support, keep the ad compliant and say so in needs_person.",
      "2. No 'best', 'cheapest', 'number one' or anything absolute. Nothing that implies the reader's personal circumstances (finances, health). No implied government endorsement.",
      "3. Australian English, plain and friendly, sentence case. No emojis, no ALL CAPS.",
      "4. Never use an em dash or en dash.",
      "5. Keep every length in the schema.",
      "6. To change a photo, pick one by its id from the library shown. If nothing there fits, keep the photo and say what's needed in needs_person.",
    ].join("\n"),
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(RevisionSchema), effort: "high" },
    fallbacks: "default",
  } as Parameters<typeof client.messages.parse>[0], FALLBACK_BETA);
  if (res.stop_reason === "refusal") throw new Error(`The model declined: ${res.stop_details?.explanation || "no reason given"}`);
  const out = res.parsed_output as z.infer<typeof RevisionSchema> | null;
  if (!out) throw new Error("The revision came back empty");

  const photoIds = new Set(photos.map((p) => p.id));
  const ads = prevAds.map((prev) => {
    const r = out.ads.find((a) => a.key === prev.key);
    if (!r) return { ...prev };
    if (prev.kind === "video") {
      // Same video already in the account; only the words around it change.
      return { ...prev, message: r.message, headline: r.headline, description: r.description };
    }
    return {
      ...prev,
      image_text: { headline: r.image_headline, subline: r.image_subline, cta: r.image_cta },
      message: r.message, headline: r.headline, description: r.description,
      photo_asset_id: r.photo_id && photoIds.has(r.photo_id) ? r.photo_id : prev.photo_asset_id,
      // Redrawn and re-added to the ad account for the new round.
      feed_url: null, story_url: null, meta: {},
    } as Ad;
  });
  return { ads, changes: { client: out.client_note, team: out.team_note, needs_person: out.needs_person || null } };
}

async function remind(admin: Admin): Promise<string | null> {
  const { data: sent } = await admin.from("creative_rounds").select("id, company_id, round, sent_at, reminders").eq("status", "sent").limit(200);
  for (const r of (sent ?? []) as Row[]) {
    const hours = (Date.now() - Date.parse(String(r.sent_at))) / 3600_000;
    const rem = (r.reminders || {}) as Row;
    const due = hours >= 120 && !rem.d5 ? "d5" : hours >= 72 && !rem.h72 ? "h72" : hours >= 24 && !rem.h24 ? "h24" : null;
    if (!due) continue;
    const company = await loadCompany(admin, String(r.company_id));
    if (!company) continue;
    await admin.from("creative_rounds").update({ reminders: { ...rem, [due]: new Date().toISOString(), ...(due === "h72" ? { h24: rem.h24 || "skipped" } : {}) } }).eq("id", r.id);
    if (due === "d5") {
      await setStep(admin, String(company.id), "previews_accepted", "blocked",
        "No answer on the previews 5 days after sending. Call them.", { id: null, name: "Automation" });
      await opsEmail(`🔴 No answer on ${company.name}'s ads after 5 days`,
        `<p><strong>${company.name}</strong> hasn't looked at or answered their ads, sent 5 days ago, after two reminders. Time for a call.</p>`);
      return `${company.name}: day 5`;
    }
    const { to, first } = await clientContact(admin, String(company.id));
    if (to && company.approval_token) {
      await sendEmail(to,
        due === "h24" ? "Your ads are waiting for a quick look" : "Still waiting on your go-ahead",
        clientHtml(first, [due === "h24"
          ? "Just a reminder that your ads are ready. It only takes a minute to look them over and tell us if you're happy."
          : "Your ads are still waiting on your go-ahead. Once you approve them, we can get your campaign ready to go live."],
        { label: "View your ads", url: approvalUrl(String(company.approval_token)) }));
    }
    return `${company.name}: ${due} reminder`;
  }
  return null;
}

async function autoStart(admin: Admin): Promise<string | null> {
  const { data: managed } = await admin.from("companies").select("id, name, dfy_profile").eq("plan", "managed");
  const ready = ((managed ?? []) as Row[]).filter((c) => metaIds(c));
  if (!ready.length) return null;
  const ids = ready.map((c) => c.id as string);
  const { data: steps } = await admin.from("company_fulfilment").select("company_id, step_key, status")
    .in("company_id", ids).in("step_key", ["ad_access_granted", "assets_provided", "previews_accepted", "campaign_built", "ads_live"]);
  const { data: rounds } = await admin.from("creative_rounds").select("company_id").in("company_id", ids);
  const hasRound = new Set(((rounds ?? []) as Row[]).map((r) => r.company_id));
  for (const c of ready) {
    if (hasRound.has(c.id)) continue;
    const done = (k: string) => ((steps ?? []) as Row[]).some((s) => s.company_id === c.id && s.step_key === k && s.status === "done");
    if (!done("ad_access_granted") || !done("assets_provided")) continue;
    // Never for a client already past previews: their ads exist.
    if (done("previews_accepted") || done("campaign_built") || done("ads_live")) continue;
    await admin.from("creative_rounds").insert({ company_id: c.id, round: 1, status: "building", build_stage: "stock", ads: [] });
    return `${c.name}: started the first pack`;
  }
  return null;
}
