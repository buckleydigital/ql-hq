// =============================================================================
// QuoteLeadsHQ — Send Password Reset via Resend
// =============================================================================
// Generates a password recovery link via Supabase Admin API and sends it
// using Resend for branded, reliable email delivery.
//
// Payload: { email: string }
// No auth required — this is a public endpoint for unauthenticated users.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { passwordResetEmail } from "../_shared/email-templates.ts";

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
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    // Generate password recovery link via Supabase Admin API
    const siteUrl = Deno.env.get("SITE_URL") ?? "http://localhost:3000";
    const { data: linkData, error: linkError } =
      await adminClient.auth.admin.generateLink({
        type: "recovery",
        email,
        options: {
          redirectTo: `${siteUrl}/dashboard.html`,
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

    // Send via Resend if configured, otherwise fall back to Supabase default
    if (resendApiKey) {
      const emailContent = passwordResetEmail(resetLink);

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: "QuoteLeadsHQ <noreply@quoteleadshq.com>",
          to: [email],
          subject: emailContent.subject,
          html: emailContent.html,
        }),
      });

      if (!resendRes.ok) {
        const errText = await resendRes.text();
        console.error("Resend password reset email failed:", errText);
        // Still return success to not reveal user existence
      }
    } else {
      console.warn("RESEND_API_KEY not set — password reset link generated but Resend email not sent");
    }

    // Always return success regardless of outcome (security best practice)
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
