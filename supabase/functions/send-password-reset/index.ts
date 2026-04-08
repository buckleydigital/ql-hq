// =============================================================================
// QuoteLeadsHQ — Send Password Reset via Resend (Custom Token)
// =============================================================================
// Generates a secure random token, stores its hash in password_reset_tokens,
// builds a branded reset link, and sends it via Resend.
//
// IMPORTANT: This function does NOT call admin.generateLink({ type: "recovery" })
// because that Supabase Admin API method triggers GoTrue's built-in mailer,
// resulting in a duplicate (unbranded) email from Supabase.  Instead we
// generate our own token and the companion "complete-password-reset" function
// verifies it and updates the password via admin.updateUser().
//
// Payload: { email: string, cf_turnstile_response: string }
// No auth required — this is a public endpoint for unauthenticated users.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Helpers ────────────────────────────────────────────────────────────────

async function verifyTurnstile(token: string): Promise<boolean> {
  const secret = Deno.env.get("CF_TURNSTILE_SECRET");
  if (!secret) {
    console.warn("CF_TURNSTILE_SECRET is not set — skipping CAPTCHA verification");
    return true;
  }
  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    },
  );
  const data = await res.json();
  return data.success === true;
}

/** Generate a cryptographically random token and return it as a URL-safe base64 string. */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // URL-safe base64 (no padding)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** SHA-256 hash of a string, returned as hex. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Inline email template ──────────────────────────────────────────────────
const _BRAND_COLOR = "#1f6fff";
const _BRAND_NAME = "QuoteLeadsHQ";
function _baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:40px 20px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08)">
<tr><td style="background:${_BRAND_COLOR};padding:24px 32px">
  <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600">${_BRAND_NAME}</h1>
</td></tr>
<tr><td style="padding:32px">
  ${content}
</td></tr>
<tr><td style="padding:16px 32px;background:#f8f9fb;border-top:1px solid #e5e7eb">
  <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">
    &copy; ${new Date().getFullYear()} ${_BRAND_NAME}. All rights reserved.
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
function _buttonHtml(text: string, url: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td>
<a href="${url}" style="display:inline-block;padding:12px 28px;background:${_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">${text}</a>
</td></tr></table>`;
}
function passwordResetEmail(resetLink: string): { subject: string; html: string } {
  return {
    subject: "Reset your QuoteLeadsHQ password",
    html: _baseLayout(`
      <h2 style="margin:0 0 16px;font-size:18px;color:#111827">Password Reset</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#374151">We received a request to reset your password. Click the button below to choose a new password.</p>
      ${_buttonHtml("Reset Password", resetLink)}
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280">This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
    `),
  };
}

// ── CORS ────────────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TOKEN_LIFETIME_MS = 60 * 60 * 1000; // 1 hour

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, cf_turnstile_response } = await req.json();

    // ── Verify Turnstile CAPTCHA ──────────────────────────────────────────
    const captchaSecretConfigured = !!Deno.env.get("CF_TURNSTILE_SECRET");
    if (captchaSecretConfigured) {
      if (!cf_turnstile_response || typeof cf_turnstile_response !== "string") {
        return new Response(
          JSON.stringify({ error: "CAPTCHA verification is required." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const turnstileOk = await verifyTurnstile(cf_turnstile_response);
      if (!turnstileOk) {
        return new Response(
          JSON.stringify({ error: "CAPTCHA verification failed. Please try again." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (!email || typeof email !== "string") {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Pre-flight: check Resend API key ───────────────────────────────
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY is not set in edge function secrets");
      return new Response(
        JSON.stringify({ error: "Email service is not configured. Please contact support." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Look up user by email ──────────────────────────────────────────
    // Uses a SECURITY DEFINER function so we don't expose auth.users via
    // PostgREST.  If the user doesn't exist we still return 200 (don't
    // reveal account existence).
    const { data: userId, error: lookupErr } = await adminClient.rpc(
      "get_auth_user_id_by_email",
      { user_email: email },
    );

    if (lookupErr) {
      console.error("User lookup error:", lookupErr.message);
    }

    if (!userId) {
      // User doesn't exist — return success to avoid email enumeration
      console.log("send-password-reset: no user found for email (returning success)");
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Generate token & store hash ────────────────────────────────────
    const rawToken = generateToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();

    const { error: insertErr } = await adminClient
      .from("password_reset_tokens")
      .insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt });

    if (insertErr) {
      console.error("Failed to store reset token:", insertErr.message);
      return new Response(
        JSON.stringify({ error: "Unable to process request. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build reset link ───────────────────────────────────────────────
    const requestOrigin = req.headers.get("Origin");
    const siteUrl = requestOrigin?.replace(/\/$/, "") || Deno.env.get("SITE_URL") || "";
    const resetLink = `${siteUrl}/dashboard#type=custom_recovery&token=${encodeURIComponent(rawToken)}`;
    console.log("send-password-reset: built custom reset link (token hash:", tokenHash.slice(0, 8), "…)");

    // ── Send via Resend ────────────────────────────────────────────────
    const emailContent = passwordResetEmail(resetLink);
    const fromEmail =
      Deno.env.get("RESEND_FROM_EMAIL") ||
      "QuoteLeadsHQ <noreply@quoteleadshq.com>";

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: emailContent.subject,
        html: emailContent.html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error(`Resend API error (HTTP ${resendRes.status}):`, errText);

      if (resendRes.status === 401 || resendRes.status === 403) {
        const hint = resendRes.status === 403
          ? "Sending domain is not verified in Resend."
          : "Invalid Resend API key.";
        console.error("Resend auth/config error:", hint);
        return new Response(
          JSON.stringify({
            error: "Email service configuration error. Please contact support.",
          }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          error: "Unable to send reset email right now. Please try again shortly.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resendData = await resendRes.json();
    console.log("Password reset email sent via Resend, id:", resendData?.id);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-password-reset error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
