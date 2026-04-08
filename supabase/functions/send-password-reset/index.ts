// =============================================================================
// QuoteLeadsHQ — Send Password Reset via Resend
// =============================================================================
// Uses admin.generateLink({ type: "recovery" }) to get a Supabase recovery
// link, then sends a branded email via Resend.  This mirrors the invite-rep
// pattern that already works.
//
// admin.generateLink() generates the link server-side WITHOUT sending any
// email — it's designed for custom email providers like Resend.
//
// When the user clicks the link, Supabase verifies the token and redirects
// to the dashboard with a recovery session.  The frontend's existing
// PASSWORD_RECOVERY auth-state handler then shows the reset modal.
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

    // ── Generate recovery link via Supabase Admin API ──────────────────
    // This is the same approach that invite-rep uses (and works).
    // admin.generateLink() generates the link server-side and returns it
    // WITHOUT sending any email — we send it ourselves via Resend.
    const siteUrl = Deno.env.get("SITE_URL") ?? "http://localhost:3000";

    const { data: linkData, error: linkError } =
      await adminClient.auth.admin.generateLink({
        type: "recovery",
        email,
        options: {
          redirectTo: `${siteUrl}/dashboard`,
        },
      });

    if (linkError || !linkData?.properties?.action_link) {
      // If the user doesn't exist, generateLink returns an error.
      // Return success anyway to prevent email enumeration.
      console.log(
        "send-password-reset: generateLink failed (user may not exist):",
        linkError?.message || "no action_link",
      );
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resetLink = linkData.properties.action_link;
    console.log("send-password-reset: generated recovery link for", email);

    // ── Send branded email via Resend ──────────────────────────────────
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
