// =============================================================================
// QuoteLeadsHQ — Resend Email Sender
// =============================================================================
// Centralised email sending via Resend (https://resend.com).
// Called internally by other edge functions (twilio-inbound-sms, quote-draft,
// invite-rep). Callers must authenticate with the SUPABASE_SERVICE_ROLE_KEY
// as a Bearer token.
//
// Environment variable: RESEND_API_KEY (set in Supabase Edge Function secrets)
//
// Payload:
// {
//   to:       string | string[],   — recipient email(s)
//   subject:  string,              — email subject
//   html:     string,              — email body (HTML)
//   text?:    string,              — plain-text fallback (optional)
//   reply_to?: string,             — reply-to address (optional)
// }
// =============================================================================

import { sendResendEmail } from "../_shared/resend.ts";

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
    // ── Auth: only internal callers (service role) may use this function ──
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("authorization") || "";
    const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    // Constant-time comparison to prevent timing attacks
    const keyBytes = new TextEncoder().encode(callerToken);
    const expectedBytes = new TextEncoder().encode(serviceRoleKey ?? "");
    let isMatch = keyBytes.length === expectedBytes.length && keyBytes.length > 0 && !!serviceRoleKey;
    const len = Math.max(keyBytes.length, expectedBytes.length);
    for (let i = 0; i < len; i++) {
      if ((keyBytes[i] ?? 0) !== (expectedBytes[i] ?? 0)) isMatch = false;
    }
    if (!isMatch) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { to, subject, html, text, reply_to } = body;

    if (!to || !subject || !html) {
      return new Response(
        JSON.stringify({ error: "to, subject, and html are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await sendResendEmail(
      { to, subject, html, text, reply_to },
      "resend-email",
    );

    if (!result.ok) {
      return new Response(
        JSON.stringify({ error: result.error || "Failed to send email" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: result.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("resend-email error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
