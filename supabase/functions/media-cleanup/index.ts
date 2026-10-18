// =============================================================================
// media-cleanup - nightly tidy of the R2 media bucket, and a self-test
// =============================================================================
// Run nightly by pg_cron. Every upload link is written to media_uploads before
// it is handed out (see _shared/upload-ledger.ts), so the files that were
// started and never finished are exactly the ledger's open rows. Those older
// than six hours (the link itself lives one) are deleted from R2, and finished
// rows older than a week are dropped from the ledger.
//
// POST {} with the x-cleanup-secret header (the vault secret
// media_cleanup_secret). { "self_test": true } instead checks the bucket end to
// end without touching anyone's files: signs an upload link, uploads a tiny
// file with it, proves a wrong-sized upload is refused, reads it back, checks
// the browser (CORS) rules, and deletes it.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { deleteObject, headObject, mediaConfigured, uploadUrl, viewUrl } from "../_shared/r2.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { "Content-Type": "application/json" } });
}

const ORIGIN = "https://quoteleadshq.com";

Deno.serve(async (req: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  const presented = req.headers.get("x-cleanup-secret") || "";
  const { data: ok } = presented ? await admin.rpc("media_cleanup_secret_ok", { p: presented }) : { data: false };
  if (ok !== true) return json({ error: "unauthorized" }, 401);
  if (!mediaConfigured()) return json({ ok: false, error: "R2 secrets are not set" }, 503);

  const body = await req.json().catch(() => ({})) as { self_test?: boolean };
  if (body.self_test) return json(await selfTest());

  const cutoff = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: open } = await admin.from("media_uploads").select("key").is("finished_at", null).lt("created_at", cutoff).limit(1000);
  let deleted = 0;
  for (const r of (open ?? []) as { key: string }[]) {
    await deleteObject(r.key);
    await admin.from("media_uploads").delete().eq("key", r.key);
    deleted++;
  }
  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  await admin.from("media_uploads").delete().not("finished_at", "is", null).lt("finished_at", weekAgo);
  return json({ ok: true, unfinished_deleted: deleted });
});

async function selfTest() {
  const key = `selftest/${crypto.randomUUID()}.png`;
  const bytes = new Uint8Array(64).fill(7);
  const steps: Record<string, unknown> = {};
  try {
    const put = await uploadUrl(key, "image/png", bytes.length);
    // The browser sends the same request, plus an Origin header.
    const pre = await fetch(put, {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
    });
    steps.cors_upload = { status: pre.status, allow_origin: pre.headers.get("access-control-allow-origin") };
    const tooBig = await fetch(put, { method: "PUT", headers: { "Content-Type": "image/png" }, body: new Uint8Array(65) });
    steps.wrong_size_refused = !tooBig.ok;
    await tooBig.body?.cancel();
    const wrongType = await fetch(put, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: bytes });
    steps.wrong_type_refused = !wrongType.ok;
    await wrongType.body?.cancel();
    const good = await fetch(put, { method: "PUT", headers: { "Content-Type": "image/png" }, body: bytes });
    steps.upload = good.status;
    await good.body?.cancel();
    steps.head = await headObject(key);
    const get = await fetch(await viewUrl(key), { headers: { Origin: ORIGIN } });
    steps.read_back = { status: get.status, bytes: (await get.arrayBuffer()).byteLength, allow_origin: get.headers.get("access-control-allow-origin") };
  } catch (e) {
    steps.error = (e as Error).message;
  } finally {
    await deleteObject(key);
    steps.deleted = (await headObject(key).catch(() => null)) === null;
  }
  const head = steps.head as { bytes?: number } | null;
  const pass = steps.upload === 200 && head?.bytes === 64 && steps.wrong_size_refused === true &&
    steps.wrong_type_refused === true && !!(steps.cors_upload as { allow_origin?: string })?.allow_origin;
  return { ok: pass, steps };
}
