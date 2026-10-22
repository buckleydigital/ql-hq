// Meta's own ad previews: what a creative looks like in Facebook and Instagram,
// rendered by Meta itself (Page name and picture, "Sponsored", the button,
// where the text is cut off), from the client's ad account and Page. Nothing
// is created that runs or spends: images and videos are added to the ad
// account's library, which is what Meta previews from, and the preview is an
// iframe Meta serves for about a day.
//
// Env: META_ACCESS_TOKEN (the system user), META_GRAPH_VERSION.
const GRAPH = `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") || "v23.0"}`;

type Json = Record<string, unknown>;

/**
 * One Graph call as the system user (or as a Page, with its token). Form
 * values that aren't strings are sent as JSON, which is how Graph takes
 * nested fields like targeting.
 */
export async function graph(path: string, init?: { method?: string; form?: Record<string, unknown>; token?: string }): Promise<Json> {
  const token = init?.token || Deno.env.get("META_ACCESS_TOKEN");
  if (!token) throw new Error("META_ACCESS_TOKEN is not set");
  let res: Response;
  if (init?.form) {
    const body = new URLSearchParams({ access_token: token });
    for (const [k, v] of Object.entries(init.form)) {
      if (v !== undefined && v !== null) body.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    res = await fetch(`${GRAPH}/${path}`, { method: init.method || "POST", body });
  } else {
    res = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`, { method: init?.method || "GET" });
  }
  const body = await res.json().catch(() => ({})) as Json;
  const err = body.error as { message?: string; error_user_title?: string; error_user_msg?: string } | undefined;
  if (!res.ok || err) {
    const detail = [err?.error_user_title, err?.error_user_msg].filter(Boolean).join(": ");
    throw new Error(`Meta: ${err?.message || `HTTP ${res.status}`}${detail ? ` (${detail})` : ""}`);
  }
  return body;
}

export const act = (accountId: string) => `act_${String(accountId).replace(/\D/g, "")}`;

/** Add an image (by URL) to the ad account's library; returns its hash. */
export async function uploadImage(accountId: string, imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Could not read the image (HTTP ${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const out = await graph(`${act(accountId)}/adimages`, { form: { bytes: btoa(bin) } });
  const first = Object.values((out.images || {}) as Record<string, { hash?: string }>)[0];
  if (!first?.hash) throw new Error("Meta returned no image hash");
  return first.hash;
}

/** Start adding a video (Meta fetches it from the URL); returns its id. */
export async function uploadVideo(accountId: string, fileUrl: string, title: string): Promise<string> {
  const out = await graph(`${act(accountId)}/advideos`, { form: { file_url: fileUrl, name: title.slice(0, 100) } });
  if (!out.id) throw new Error("Meta returned no video id");
  return String(out.id);
}

/** Whether Meta has finished processing a video, and its thumbnail once it has. */
export async function videoState(videoId: string): Promise<{ ready: boolean; failed: boolean; thumbnail: string | null }> {
  const out = await graph(`${videoId}?fields=status,picture`);
  const s = String(((out.status || {}) as Json).video_status || "");
  return { ready: s === "ready", failed: s === "error", thumbnail: (out.picture as string) || null };
}

// Where the ad can show, as Meta names it, and which of our image shapes it uses.
export const PLACEMENTS = [
  { format: "MOBILE_FEED_STANDARD", label: "Facebook feed", shape: "feed" },
  { format: "INSTAGRAM_STANDARD", label: "Instagram feed", shape: "feed" },
  { format: "INSTAGRAM_STORY", label: "Instagram Stories", shape: "story" },
  { format: "FACEBOOK_STORY_MOBILE", label: "Facebook Stories", shape: "story" },
  { format: "INSTAGRAM_REELS", label: "Instagram Reels", shape: "story" },
] as const;

export type AdCopy = { message: string; headline: string; description: string; cta: string; link: string };

/** The creative Meta previews, for one image or video. */
export function creativeSpec(pageId: string, copy: AdCopy, media: { imageHash?: string; videoId?: string; thumbnail?: string }) {
  const call_to_action = { type: copy.cta || "GET_QUOTE", value: { link: copy.link } };
  if (media.videoId) {
    return {
      object_story_spec: {
        page_id: pageId,
        video_data: {
          video_id: media.videoId, image_url: media.thumbnail, message: copy.message, title: copy.headline,
          link_description: copy.description, call_to_action,
        },
      },
    };
  }
  return {
    object_story_spec: {
      page_id: pageId,
      link_data: {
        image_hash: media.imageHash, link: copy.link, message: copy.message, name: copy.headline,
        description: copy.description, call_to_action,
      },
    },
  };
}

export type Preview = { url: string; w: number; h: number };

/** Meta's rendering of a creative in one placement: an iframe URL (valid about a day) and its size. */
export async function preview(accountId: string, spec: Json, format: string): Promise<Preview> {
  const q = `${act(accountId)}/generatepreviews?ad_format=${format}&creative=${encodeURIComponent(JSON.stringify(spec))}`;
  const out = await graph(q);
  const body = String(((out.data as Json[] | undefined)?.[0] || {}).body || "");
  const src = body.match(/src="([^"]+)"/)?.[1];
  if (!src) throw new Error("Meta returned no preview");
  const dim = (k: string) => Number(body.match(new RegExp(`${k}="(\\d+)"`))?.[1]) || 0;
  return { url: src.replace(/&amp;/g, "&"), w: dim("width"), h: dim("height") };
}
