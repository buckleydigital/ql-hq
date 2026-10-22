// What a preview round's ads look like on Meta, shared by the team's review
// screen (creative-rounds) and the client's page (creative-approval), so both
// see exactly the same thing.
//
// An ad in a round (creative_rounds.ads):
//   key            stable within the round ("a1", "v1")
//   kind           "image" or "video"
//   image_text     { headline, subline, cta }: the words drawn on the image
//   message, headline, description: Meta's primary text, headline and link
//                  description, shown around the image
//   photo_asset_id / video_asset_id: from the client's library
//   feed_url, story_url: the drawn images (4:5 and 9:16)
//   meta           { feed_hash, story_hash, video_id, thumbnail }: the same
//                  images and video in the client's ad account
import type { createClient } from "npm:@supabase/supabase-js@2";
import { creativeSpec, PLACEMENTS, preview, type Preview } from "./meta-ads.ts";

type Admin = ReturnType<typeof createClient>;
type Row = Record<string, unknown>;
export type Ad = Row & {
  key: string; kind: "image" | "video";
  image_text?: { headline?: string; subline?: string; cta?: string };
  message: string; headline: string; description: string;
  photo_asset_id?: string | null; video_asset_id?: string | null;
  feed_url?: string | null; story_url?: string | null;
  meta?: { feed_hash?: string; story_hash?: string; video_id?: string; thumbnail?: string; video_ready?: boolean; video_failed?: boolean };
};

// Meta's preview links last about a day; ours are refreshed well before that.
const PREVIEW_TTL_MS = 12 * 3600 * 1000;

export function metaIds(company: Row): { account: string; page: string } | null {
  const m = ((company.dfy_profile || {}) as Row).meta_access as { ad_account_id?: string; page_id?: string } | undefined;
  return m?.ad_account_id && m.page_id ? { account: String(m.ad_account_id), page: String(m.page_id) } : null;
}

/** Where the ad's button sends people until the lead form exists (Phase 4). */
export function adLink(company: Row, pageId: string): string {
  const site = String(company.website_url || "").trim();
  if (/^https?:\/\//i.test(site)) return site;
  if (site) return `https://${site.replace(/^\/+/, "")}`;
  return `https://www.facebook.com/${pageId}`;
}

export type AdPreview = { key: string; kind: string; placements: (Preview & { format: string; label: string })[]; pending?: string };

/**
 * Meta's rendering of every ad in every placement, from cache when fresh.
 * A video Meta is still processing has no previews yet and says so.
 */
export async function roundPreviews(admin: Admin, round: Row, company: Row, opts: { refresh?: boolean } = {}): Promise<AdPreview[]> {
  const ids = metaIds(company);
  if (!ids) throw new Error("The client's ad account and Facebook Page aren't connected yet");
  const ads = (round.ads || []) as Ad[];
  const cache = (round.previews || {}) as { at?: string; items?: Record<string, Record<string, Preview>> };
  const fresh = !opts.refresh && cache.at && Date.now() - Date.parse(cache.at) < PREVIEW_TTL_MS;
  const items: Record<string, Record<string, Preview>> = fresh ? { ...(cache.items || {}) } : {};
  const link = adLink(company, ids.page);
  let changed = !fresh;

  const out = await Promise.all(ads.map(async (ad): Promise<AdPreview> => {
    const m = ad.meta || {};
    if (ad.kind === "video" && !(m.video_id && m.video_ready)) {
      return { key: ad.key, kind: ad.kind, placements: [], pending: m.video_failed ? "Meta couldn't process this video" : "Meta is still processing this video" };
    }
    if (ad.kind === "image" && !m.feed_hash) return { key: ad.key, kind: ad.kind, placements: [], pending: "Not in the ad account yet" };
    const have = items[ad.key] || {};
    const placements = await Promise.all(PLACEMENTS.map(async (p) => {
      if (have[p.format]) return { format: p.format, label: p.label, ...have[p.format] };
      const copy = { message: ad.message, headline: ad.headline, description: ad.description, cta: "GET_QUOTE", link };
      // Stories and Reels use the 9:16 image when there is one.
      const media = ad.kind === "video"
        ? { videoId: m.video_id, thumbnail: m.thumbnail }
        : { imageHash: p.shape === "story" && m.story_hash ? m.story_hash : m.feed_hash };
      try {
        const got = await preview(ids.account, creativeSpec(ids.page, copy, media), p.format);
        have[p.format] = got;
        changed = true;
        return { format: p.format, label: p.label, ...got };
      } catch (e) {
        console.warn("preview failed", ad.key, p.format, (e as Error).message);
        return null;
      }
    }));
    items[ad.key] = have;
    return { key: ad.key, kind: ad.kind, placements: placements.filter(Boolean) as AdPreview["placements"] };
  }));

  if (changed) {
    await admin.from("creative_rounds").update({ previews: { at: fresh ? cache.at : new Date().toISOString(), items } }).eq("id", round.id);
  }
  return out;
}

/** The ad copy as numbered lines for the ad rules check, by ad position. */
export function roundLines(ads: Ad[]) {
  const out: { where: "meta_primary_text" | "meta_headline" | "meta_description" | "image_headline" | "image_subline" | "image_cta"; index: number; text: string }[] = [];
  ads.forEach((ad, i) => {
    const push = (where: (typeof out)[number]["where"], t: unknown) => { if (typeof t === "string" && t.trim()) out.push({ where, index: i, text: t }); };
    push("meta_primary_text", ad.message);
    push("meta_headline", ad.headline);
    push("meta_description", ad.description);
    if (ad.kind === "image") {
      push("image_headline", ad.image_text?.headline);
      push("image_subline", ad.image_text?.subline);
      push("image_cta", ad.image_text?.cta);
    }
  });
  return out;
}

/** Put a rewritten line back into its ad. */
export function setRoundLine(ads: Ad[], where: string, index: number, text: string) {
  const ad = ads[index];
  if (!ad) return;
  if (where === "meta_primary_text") ad.message = text;
  else if (where === "meta_headline") ad.headline = text;
  else if (where === "meta_description") ad.description = text;
  else if (where.startsWith("image_")) ad.image_text = { ...(ad.image_text || {}), [where.slice(6)]: text };
}
