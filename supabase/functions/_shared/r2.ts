// Client media (photos, videos, logos) and the stock library live in a
// Cloudflare R2 bucket rather than Supabase Storage: video files run to
// hundreds of megabytes, past what the Supabase plan allows per file. The
// bucket is private. Browsers upload straight to it with a short-lived signed
// PUT URL, and read from it with a signed GET URL, so no file ever passes
// through an edge function.
//
// This file is the only place that knows where media is stored. Moving to
// Supabase Storage later means changing these functions, not their callers.
//
// Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
import { AwsClient } from "npm:aws4fetch@1";

function config() {
  const account = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET");
  if (!account || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }),
    base: `https://${account}.r2.cloudflarestorage.com/${bucket}`,
  };
}

export const mediaConfigured = () => config() !== null;

// Keys are made by us, never taken whole from a caller: each segment is
// encoded so a key can't climb out of its folder.
const objectUrl = (base: string, key: string) =>
  `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

async function presign(method: "GET" | "PUT", key: string, seconds: number): Promise<string> {
  const c = config();
  if (!c) throw new Error("Media storage is not set up yet (R2 secrets missing).");
  const url = new URL(objectUrl(c.base, key));
  url.searchParams.set("X-Amz-Expires", String(seconds));
  const signed = await c.client.sign(url.toString(), { method, aws: { signQuery: true } });
  return signed.url;
}

/** A URL the browser can PUT the file to, valid for an hour. */
export const uploadUrl = (key: string) => presign("PUT", key, 3600);

/** A URL to view or download the file, valid for six hours. */
export const viewUrl = (key: string) => presign("GET", key, 6 * 3600);

/** Size and type of a stored file, or null if it isn't there. */
export async function headObject(key: string): Promise<{ bytes: number; contentType: string } | null> {
  const c = config();
  if (!c) throw new Error("Media storage is not set up yet (R2 secrets missing).");
  const res = await c.client.fetch(objectUrl(c.base, key), { method: "HEAD" });
  if (!res.ok) return null;
  return { bytes: Number(res.headers.get("content-length") || 0), contentType: res.headers.get("content-type") || "" };
}

export async function deleteObject(key: string): Promise<void> {
  const c = config();
  if (!c) return;
  await c.client.fetch(objectUrl(c.base, key), { method: "DELETE" }).catch(() => null);
}

// What we accept, and the most we take of each.
export const MEDIA_TYPES: Record<string, { kind: "image" | "video"; ext: string }> = {
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/png": { kind: "image", ext: "png" },
  "image/webp": { kind: "image", ext: "webp" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
};
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
