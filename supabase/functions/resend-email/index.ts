// =============================================================================
// QuoteLeadsHQ — Resend Email Sender
// =============================================================================
// Centralised email sending via Resend (https://resend.com).
// Called by other edge functions (twilio-inbound-sms, quote-draft, invite-rep)
// or directly from the dashboard for transactional emails.
//
// Environment variable: RESEND_API_KEY (set in Supabase Edge Function secrets)
//
// Payload:
// {
//   to:       string | string[],   — recipient email(s)
//   subject:  string,              — email subject
//   html:     string,              — email body (HTML)
//   text?:    string,              — plain-text fallback (optional)
//   from?:    string,              — sender (defaults to noreply@quoteleadshq.com)
//   reply_to?: string,             — reply-to address (optional)
// }
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_FROM = "QuoteLeadsHQ <noreply@quoteleadshq.com>";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { to, subject, html, text, from, reply_to } = body;

    if (!to || !subject || !html) {
      return new Response(
        JSON.stringify({ error: "to, subject, and html are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Send email via Resend API
    const resendPayload: Record<string, unknown> = {
      from: from || DEFAULT_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    };

    if (text) resendPayload.text = text;
    if (reply_to) resendPayload.reply_to = reply_to;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify(resendPayload),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error("Resend API error:", resendData);
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: resendData }),
        { status: resendRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: resendData.id }),
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
