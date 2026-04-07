// =============================================================================
// QuoteLeadsHQ — Shared Resend Email Helper
// =============================================================================
// Centralises the Resend API call pattern so every email-sending edge function
// gets: proper response-body consumption, structured logging, and consistent
// error categorisation.
//
// Usage:
//   import { sendResendEmail } from "../_shared/resend.ts";
//   const result = await sendResendEmail({ to: [email], subject, html });
// =============================================================================

/** Categorised result returned by sendResendEmail. */
export interface ResendResult {
  /** Whether the Resend API accepted the email (HTTP 2xx). */
  ok: boolean;
  /** Resend email ID on success, null on failure. */
  id: string | null;
  /** Human-readable error message on failure, null on success. */
  error: string | null;
  /** HTTP status code returned by Resend (0 if the fetch itself threw). */
  status: number;
  /**
   * Error category — helps callers decide what to show to end-users.
   *  • "config"    – API key missing/invalid, or domain not verified (fix in dashboard)
   *  • "validation" – bad payload (e.g. invalid "to" address)
   *  • "rate_limit" – too many emails, retry later
   *  • "transient"  – Resend 5xx or network error, retry later
   *  • null         – no error
   */
  category: "config" | "validation" | "rate_limit" | "transient" | null;
}

export interface ResendEmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
}

/**
 * Send an email via the Resend API.
 *
 * Always consumes the response body (preventing Deno Deploy connection leaks)
 * and logs enough detail to diagnose issues from the Edge Function logs.
 *
 * @param payload  – email fields (to, subject, html, …)
 * @param caller   – name of the calling function, used in log messages
 *                   (e.g. "invite-rep", "send-password-reset")
 */
export async function sendResendEmail(
  payload: ResendEmailPayload,
  caller = "unknown",
): Promise<ResendResult> {
  // ── 1. Resolve configuration ──────────────────────────────────────────
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    const msg = "RESEND_API_KEY is not set in edge function secrets";
    console.error(`[${caller}] ${msg}`);
    return { ok: false, id: null, error: msg, status: 0, category: "config" };
  }

  const from =
    Deno.env.get("RESEND_FROM_EMAIL") ||
    "QuoteLeadsHQ <noreply@quoteleadshq.com>";

  const toArr = Array.isArray(payload.to) ? payload.to : [payload.to];

  // ── 2. Build the Resend request body ──────────────────────────────────
  const body: Record<string, unknown> = {
    from,
    to: toArr,
    subject: payload.subject,
    html: payload.html,
  };
  if (payload.text) body.text = payload.text;
  if (payload.reply_to) body.reply_to = payload.reply_to;

  // ── 3. Call the Resend API ────────────────────────────────────────────
  let resendRes: Response;
  try {
    resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (fetchErr) {
    const msg =
      fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    console.error(`[${caller}] Resend fetch threw:`, msg);
    return {
      ok: false,
      id: null,
      error: `Network error calling Resend API: ${msg}`,
      status: 0,
      category: "transient",
    };
  }

  // ── 4. ALWAYS consume the response body ───────────────────────────────
  //    Deno Deploy keeps the underlying TCP connection open until the body
  //    is fully read.  Leaving it unconsumed can leak connections and, in
  //    edge cases, cause the isolate to be recycled before the response is
  //    finalised.
  let resendData: Record<string, unknown> | null = null;
  let rawBody = "";
  try {
    rawBody = await resendRes.text();
    resendData = JSON.parse(rawBody);
  } catch {
    // Non-JSON body (e.g. HTML error page from a gateway)
    resendData = null;
  }

  // ── 5. Classify the result ────────────────────────────────────────────
  if (resendRes.ok) {
    const emailId = (resendData?.id as string | undefined) ?? null;
    console.log(
      `[${caller}] Resend email sent successfully — id: ${emailId}, to: ${toArr.join(", ")}, subject: "${payload.subject}"`,
    );
    return { ok: true, id: emailId, error: null, status: resendRes.status, category: null };
  }

  // — Failure path — extract Resend's error message
  const resendMsg =
    (resendData?.message as string | undefined) ??
    rawBody.slice(0, 500);
  const status = resendRes.status;

  console.error(
    `[${caller}] Resend API error (HTTP ${status}): ${resendMsg} | to: ${toArr.join(", ")} | from: ${from}`,
  );

  let category: ResendResult["category"];
  let friendlyError: string;

  switch (true) {
    case status === 401:
      category = "config";
      friendlyError =
        "Invalid Resend API key. Check that RESEND_API_KEY is correct in your Supabase Edge Function secrets.";
      break;
    case status === 403:
      category = "config";
      friendlyError =
        `Resend rejected the sender address (${from}). ` +
        "Ensure the sending domain is verified in Resend and the API key belongs to the same team. " +
        `Resend said: "${resendMsg}"`;
      break;
    case status === 422:
      category = "validation";
      friendlyError = `Resend validation error: ${resendMsg}`;
      break;
    case status === 429:
      category = "rate_limit";
      friendlyError = "Resend rate limit reached — please try again shortly.";
      break;
    default:
      category = "transient";
      friendlyError = `Resend error (HTTP ${status}): ${resendMsg}`;
  }

  return { ok: false, id: null, error: friendlyError, status, category };
}
