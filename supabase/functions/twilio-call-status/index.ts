// twilio-call-status — Twilio reports back how an outbound Team Panel call went.
//
// Without this the call log would only ever say "queued": whether anyone picked
// up, how long they spoke and why a call failed are facts only Twilio has.
//
// Public by necessity - Twilio has to be able to reach it - so it is written to
// be useless to anyone else. It authenticates on a shared secret in the query
// string, updates exactly one pre-existing row by the id we handed Twilio when
// we placed the call, and writes nothing but call status fields. It cannot
// create a row, cannot place a call, and cannot be used to read anything back:
// every response is a bare 200 or 403 with no body.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Twilio retries on a non-2xx, so anything that is not worth retrying answers
// 200. A 500 here would earn a stream of duplicate deliveries for a row that is
// never going to update.
const ok = () => new Response("", { status: 200 });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return ok();

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const logId = url.searchParams.get("log") ?? "";
  const expected = Deno.env.get("TWILIO_STATUS_SECRET") ?? "";

  // The log id is the credential. It is a v4 uuid handed to Twilio when the
  // call was placed, so it is not guessable, and all this endpoint can do with
  // it is set status fields on that one already-existing row - it cannot create
  // a row, read one back, or place a call.
  //
  // Requiring a separate secret INSTEAD of this was worse than it looked: the
  // callback was simply not requested when the secret was unset, so the one
  // configuration nobody had done was the one that made failures legible. A
  // call then failed with "an application error has occurred" and left no error
  // code anywhere to explain it.
  //
  // A configured secret is still enforced, so setting one tightens this further
  // rather than being ignored.
  if (expected && token !== expected) {
    return new Response("forbidden", { status: 403 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(logId)) return ok();

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await req.text());
  } catch {
    return ok();
  }

  const status = form.get("CallStatus");
  if (!status) return ok();

  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  // Only present on the final callback, and only meaningful when the call
  // actually connected.
  const dur = Number(form.get("CallDuration") ?? "");
  if (Number.isFinite(dur) && dur > 0) patch.duration_secs = Math.round(dur);

  // Twilio sends this on a failed call. It is the difference between "the
  // client did not pick up" and "your account cannot dial this country", and
  // that distinction is the whole reason to log failures.
  const errCode = form.get("ErrorCode");
  if (errCode) patch.error_code = String(errCode).slice(0, 32);

  // Scoped to the one row, and the row must already exist - this never inserts.
  const { error } = await db.from("call_log").update(patch).eq("id", logId);
  if (error) console.error("twilio-call-status: update failed:", error.message);

  return ok();
});
