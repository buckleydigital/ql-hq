// =============================================================================
// QuoteLeadsHQ — Send Password Reset via Resend
// =============================================================================
// Generates a password recovery link via Supabase Admin API and sends it
// using Resend for branded, reliable email delivery.
//
// Payload: { email: string, cf_turnstile_response: string }
// No auth required — this is a public endpoint for unauthenticated users.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendResendEmail } from "../_shared/resend.ts";

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

// ── Inline email template (avoids local-file import that breaks deployment) ──
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, cf_turnstile_response } = await req.json();

    // ── Verify Turnstile CAPTCHA ──────────────────────────────────────────
    // Only require a token when CF_TURNSTILE_SECRET is configured.
    // When the secret is absent the server is in bypass mode and we skip
    // verification entirely so that environments without Turnstile still work.
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

    // ── Pre-flight: check Resend API key is configured ─────────────────
    // This is an infrastructure issue affecting ALL users, so it's safe to
    // surface without leaking whether a specific email exists.
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

    // Generate password recovery link via Supabase Admin API
    const siteUrl = Deno.env.get("SITE_URL") ?? "http://localhost:3000";
    console.log("send-password-reset: using SITE_URL =", siteUrl);

    const { data: linkData, error: linkError } =
      await adminClient.auth.admin.generateLink({
        type: "recovery",
        email,
        options: {
          redirectTo: `${siteUrl}/dashboard`,
        },
      });

    if (linkError) {
      // Don't reveal whether the email exists — always return success
      console.error("generateLink error:", linkError.message);
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resetLink = linkData?.properties?.action_link;
    if (!resetLink) {
      console.error("No action_link returned from generateLink");
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Send via Resend ────────────────────────────────────────────────
    const emailContent = passwordResetEmail(resetLink);

    const resendResult = await sendResendEmail(
      { to: [email], subject: emailContent.subject, html: emailContent.html },
      "send-password-reset",
    );

    if (!resendResult.ok) {
      // Auth/config errors (bad API key, domain not verified) affect ALL
      // users and don't reveal whether this specific email exists.
      if (resendResult.category === "config") {
        return new Response(
          JSON.stringify({
            error: "Email service configuration error. Please contact support.",
          }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // For other Resend errors (validation, rate-limit, transient),
      // return a retriable error.
      return new Response(
        JSON.stringify({
          error: "Unable to send reset email right now. Please try again shortly.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
