// =============================================================================
// client-assets - a managed client's logo, photos and videos, from onboarding
// =============================================================================
// The client dashboard's onboarding page calls this to:
//
//   state          what they've given us so far, and their choices
//   save           their choices: their own media or our stock library, their
//                  brand colour, and any reviews or testimonials
//   start_upload   a signed URL their browser PUTs the file to (Cloudflare R2,
//                  see _shared/r2.ts), so large videos never pass through here
//   finish_upload  checks the file arrived, and adds it to their library
//   delete         removes something they uploaded (only their own)
//   done           "that's everything": ticks "Assets & testimonials received"
//                  and tells the team
//
// The library is the same company_assets the creative studio reads, so what a
// client uploads is in the studio straight away, marked as theirs.
//
// Called with the client's own login. The company is taken from their profile,
// never from the request, and only managed clients have this page.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import "../_shared/no-em-dash.ts";
import {
  deleteObject, headObject, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MEDIA_TYPES, mediaConfigured, uploadUrl, viewUrl,
} from "../_shared/r2.ts";
import { claimUpload, inFlight, reserveUpload } from "../_shared/upload-ledger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const STEP = "assets_provided";
const MAX_PHOTOS = 60;
const MAX_VIDEOS = 15;
const HEX = /^#[0-9a-f]{6}$/i;

type Row = Record<string, unknown>;
type Admin = ReturnType<typeof createClient>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } });
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Not authenticated" }, 401);

    const { data: me } = await admin.from("profiles").select("company_id, full_name").eq("id", user.id).maybeSingle();
    const companyId = me?.company_id as string | undefined;
    if (!companyId) return json({ error: "No company on this login" }, 403);
    const { data: company } = await admin.from("companies")
      .select("id, name, plan, brand_color, creative_source, client_testimonials").eq("id", companyId).maybeSingle();
    if (!company || company.plan !== "managed") return json({ error: "This is only for managed campaign clients" }, 403);

    const ctx = { admin, companyId, company: company as Row, actor: { id: user.id, name: (me?.full_name as string) || user.email || "Client" } };
    const body = await req.json().catch(() => ({})) as Row;
    switch (body.action) {
      case "state":         return await state(ctx);
      case "save":          return await save(ctx, body);
      case "start_upload":  return await startUpload(ctx, body);
      case "finish_upload": return await finishUpload(ctx, body);
      case "delete":        return await remove(ctx, body);
      case "done":          return await done(ctx, body);
    }
    return json({ error: `Unknown action: ${body.action}` }, 400);
  } catch (err) {
    console.error("client-assets error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});

type Ctx = { admin: Admin; companyId: string; company: Row; actor: { id: string; name: string } };

const ASSET_COLS = "id, kind, url, path, storage, source, content_type, bytes, width, height, label, created_at";

// A browser-usable URL for an asset: R2 files are signed on the way out.
async function withUrl(a: Row): Promise<Row> {
  const url = a.storage === "r2" ? await viewUrl(a.path as string).catch(() => null) : a.url;
  const { path: _p, ...rest } = a;
  return { ...rest, url };
}

async function library(ctx: Ctx) {
  const { data } = await ctx.admin.from("company_assets").select(ASSET_COLS)
    .eq("company_id", ctx.companyId).order("created_at", { ascending: true });
  return (data ?? []) as Row[];
}

async function state(ctx: Ctx) {
  const [assets, { data: step }] = await Promise.all([
    library(ctx),
    ctx.admin.from("company_fulfilment").select("status").eq("company_id", ctx.companyId).eq("step_key", STEP).maybeSingle(),
  ]);
  return json({
    creative_source: ctx.company.creative_source ?? null,
    brand_color: ctx.company.brand_color ?? null,
    client_testimonials: ctx.company.client_testimonials ?? "",
    // Stock picked by the team shows as part of their library, not as theirs.
    assets: await Promise.all(assets.map(withUrl)),
    done: step?.status === "done",
    uploads_ready: mediaConfigured(),
    limits: { photos: MAX_PHOTOS, videos: MAX_VIDEOS, image_mb: MAX_IMAGE_BYTES / 1048576, video_mb: MAX_VIDEO_BYTES / 1048576 },
  });
}

async function save(ctx: Ctx, b: Row) {
  const patch: Row = {};
  if ("creative_source" in b) {
    if (b.creative_source !== "custom" && b.creative_source !== "stock") return json({ error: "Choose your own photos or our stock library" }, 400);
    patch.creative_source = b.creative_source;
  }
  if ("brand_color" in b) {
    const c = String(b.brand_color ?? "").trim();
    if (c && !HEX.test(c)) return json({ error: "Brand colour must be a hex colour like #1063d6" }, 400);
    patch.brand_color = c ? c.toLowerCase() : null;
  }
  if ("client_testimonials" in b) patch.client_testimonials = String(b.client_testimonials ?? "").trim().slice(0, 6000) || null;
  if (!Object.keys(patch).length) return json({ ok: true });
  const { error } = await ctx.admin.from("companies").update(patch).eq("id", ctx.companyId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

function kindOf(b: Row): "logo" | "photo" | "video" | null {
  return b.kind === "logo" || b.kind === "photo" || b.kind === "video" ? b.kind : null;
}

async function startUpload(ctx: Ctx, b: Row) {
  if (!mediaConfigured()) return json({ error: "Uploads aren't switched on yet. Please email your files to contact@quoteleads.com.au for now." }, 503);
  const kind = kindOf(b);
  const type = MEDIA_TYPES[String(b.content_type || "")];
  const bytes = Number(b.bytes) || 0;
  if (!kind) return json({ error: "Unknown kind of file" }, 400);
  if (!type) return json({ error: "Photos must be JPG, PNG or WebP, and videos MP4 or MOV" }, 400);
  if ((kind === "video") !== (type.kind === "video")) return json({ error: kind === "video" ? "That isn't a video file" : "That isn't an image file" }, 400);
  const max = type.kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (bytes <= 0 || bytes > max) return json({ error: `Files can be up to ${Math.round(max / 1048576)} MB` }, 400);
  if (kind !== "logo") {
    // Uploads still in flight count too, so the cap can't be beaten by
    // starting many at once.
    const { count } = await ctx.admin.from("company_assets").select("id", { count: "exact", head: true })
      .eq("company_id", ctx.companyId).eq("kind", kind).eq("source", "client");
    const cap = kind === "video" ? MAX_VIDEOS : MAX_PHOTOS;
    if ((count ?? 0) + await inFlight(ctx.admin, ctx.companyId, kind) >= cap) {
      return json({ error: `That's the most ${kind}s we can take (${cap}). Remove one to add another.` }, 400);
    }
  }
  const key = `${ctx.companyId}/client/${crypto.randomUUID()}.${type.ext}`;
  const contentType = String(b.content_type);
  const refused = await reserveUpload(ctx.admin, { key, companyId: ctx.companyId, kind, bytes, contentType, userId: ctx.actor.id });
  if (refused) return json({ error: refused }, 429);
  return json({ ok: true, key, upload_url: await uploadUrl(key, contentType, bytes) });
}

async function finishUpload(ctx: Ctx, b: Row) {
  const kind = kindOf(b);
  const key = String(b.key || "");
  // Only a key this client was given: their folder, one of our file names.
  if (!kind || !new RegExp(`^${ctx.companyId}/client/[0-9a-f-]{36}\\.(jpg|png|webp|mp4|mov)$`).test(key)) {
    return json({ error: "Unknown upload" }, 400);
  }
  // Only an upload we handed a link out for, finished once.
  const ledger = await claimUpload(ctx.admin, key, ctx.companyId);
  if (!ledger || ledger.kind !== kind) return json({ error: "Unknown upload" }, 400);
  const head = await headObject(key);
  if (!head) return json({ error: "The file didn't arrive. Please try again." }, 400);
  const type = MEDIA_TYPES[head.contentType.split(";")[0]];
  const max = type?.kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (!type || head.bytes > max || head.bytes !== Number(ledger.bytes) || (kind === "video") !== (type.kind === "video")) {
    await deleteObject(key);
    return json({ error: "That file is the wrong type or too big" }, 400);
  }

  // One logo: a new one replaces the old, whoever uploaded it.
  if (kind === "logo") {
    const { data: old } = await ctx.admin.from("company_assets").select("id, path, storage, source")
      .eq("company_id", ctx.companyId).eq("kind", "logo");
    for (const o of (old ?? []) as Row[]) {
      if (o.storage === "r2") await deleteObject(o.path as string);
      else await ctx.admin.storage.from("preview-images").remove([o.path as string]);
    }
    if (old?.length) await ctx.admin.from("company_assets").delete().in("id", (old as Row[]).map((o) => o.id as string));
  }

  const dim = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
  const { data, error } = await ctx.admin.from("company_assets").insert({
    company_id: ctx.companyId, kind, url: null, path: key, storage: "r2", source: "client",
    content_type: head.contentType || null, bytes: head.bytes,
    width: dim(b.width), height: dim(b.height),
    label: String(b.filename || "").trim().slice(0, 200) || null,
    created_by: ctx.actor.id,
  }).select(ASSET_COLS).single();
  if (error) { await deleteObject(key); return json({ error: error.message }, 500); }
  return json({ ok: true, asset: await withUrl(data as Row) });
}

async function remove(ctx: Ctx, b: Row) {
  const { data: row } = await ctx.admin.from("company_assets").select("id, path, storage")
    .eq("id", String(b.asset_id || "")).eq("company_id", ctx.companyId).eq("source", "client").maybeSingle();
  if (!row) return json({ error: "You can only remove files you uploaded" }, 404);
  if (row.storage === "r2") await deleteObject(row.path as string);
  await ctx.admin.from("company_assets").delete().eq("id", row.id);
  return json({ ok: true });
}

async function done(ctx: Ctx, b: Row) {
  if ("client_testimonials" in b || "creative_source" in b) {
    const saved = await save(ctx, b);
    if (saved.status !== 200) return saved;
  }
  const { data: co } = await ctx.admin.from("companies").select("creative_source, client_testimonials").eq("id", ctx.companyId).maybeSingle();
  const assets = await library(ctx);
  const mine = assets.filter((a) => a.source === "client");
  const n = (k: string) => mine.filter((a) => a.kind === k).length;
  const source = co?.creative_source as string | null;
  if (!source) return json({ error: "Choose your own photos and videos, or our stock library" }, 400);
  if (source === "custom" && !n("photo") && !n("video")) {
    return json({ error: "Add at least one photo or video, or choose our stock library instead" }, 400);
  }
  const hasLogo = assets.some((a) => a.kind === "logo");
  const parts = [
    source === "stock" ? "Chose the stock library" : "Using their own media",
    `${n("photo")} photo${n("photo") === 1 ? "" : "s"}, ${n("video")} video${n("video") === 1 ? "" : "s"}`,
    hasLogo ? "logo uploaded" : "no logo",
    co?.client_testimonials ? "testimonials given" : "",
  ].filter(Boolean);
  const note = parts.join(", ");
  await setStep(ctx, "done", note);

  const key = Deno.env.get("RESEND_API_KEY");
  if (key) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "QuoteLeads System <system@quoteleads.com.au>",
        to: "contact@quoteleads.com.au",
        subject: `${hasLogo ? "✅" : "⚠️"} Creative assets received - ${ctx.company.name}`,
        html: `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#333;line-height:1.7">` +
          `<p><strong>${ctx.company.name}</strong> finished the media step in onboarding: ${note}.</p>` +
          (hasLogo ? "" : `<p style="color:#b42318">No logo yet. The creatives can't carry their branding without one.</p>`) +
          `<p>Open their creative studio in the Team Panel and press <strong>Build preview pack</strong>.</p></div>`,
      }),
    }).catch((e) => console.warn("ops email failed:", e));
  }
  return json({ ok: true, note });
}

// Same contract as the other functions' setStep: the step, a log line, and
// the Mission Control mirror.
async function setStep(ctx: Ctx, status: string, notes: string) {
  const settled = status === "done" || status === "skipped";
  const { data: prev } = await ctx.admin.from("company_fulfilment").select("status")
    .eq("company_id", ctx.companyId).eq("step_key", STEP).maybeSingle();
  await ctx.admin.from("company_fulfilment").upsert({
    company_id: ctx.companyId, step_key: STEP, status, notes: notes.slice(0, 2000),
    completed_by: settled ? ctx.actor.id : null, completed_by_name: settled ? ctx.actor.name : null,
  }, { onConflict: "company_id,step_key" });
  await ctx.admin.from("fulfilment_log").insert({
    company_id: ctx.companyId, actor_id: ctx.actor.id, actor_name: ctx.actor.name, action: "fulfilment.step_set",
    step_key: STEP, from_status: prev?.status ?? "pending", to_status: status, detail: { notes: notes.slice(0, 500) },
  });
  const url = Deno.env.get("QL_MC_API_URL"), secret = Deno.env.get("QL_MC_API_SECRET");
  if (!url || !secret) return;
  try {
    const { data: sum } = await ctx.admin.from("company_fulfilment_summary")
      .select("stage, stage_at, active_status, steps_done, steps_settled, steps_total, blocked_count, next_step_key, next_step_due")
      .eq("company_id", ctx.companyId).maybeSingle();
    if (sum) {
      await fetch(`${url}/sync-from-hq`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-api-secret": secret },
        body: JSON.stringify({ action: "upsert_fulfilment", hq_company_id: ctx.companyId, summary: sum }),
      });
    }
  } catch (e) {
    console.warn("ql-mc mirror failed:", (e as Error).message);
  }
}
