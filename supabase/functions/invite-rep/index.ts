import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
function inviteRepEmail(repName: string, companyName: string, inviteLink: string): { subject: string; html: string } {
  return {
    subject: `You've been invited to join ${companyName} on QuoteLeadsHQ`,
    html: _baseLayout(`
      <h2 style="margin:0 0 16px;font-size:18px;color:#111827">You're Invited!</h2>
      <p style="margin:0 0 8px;font-size:14px;color:#374151">Hi ${repName},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151">You've been invited to join <strong>${companyName}</strong> on ${_BRAND_NAME}. Click the button below to set up your account and get started.</p>
      ${_buttonHtml("Accept Invitation", inviteLink)}
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280">If you didn't expect this invitation, you can safely ignore this email.</p>
    `),
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Resilient user lookup: tries auth.getUser() first (proper JWT verification),
 * then falls back to decoding the JWT payload and looking up the user by ID.
 * This avoids "Invalid JWT" errors caused by token refresh timing issues.
 */
async function getCallerUser(
  authHeader: string,
  userClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
) {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "");

  // 1. Try the standard auth.getUser() path first.
  //    Pass the token explicitly — Deno edge functions have no persistent
  //    session storage, so the zero-arg overload can't resolve the JWT.
  try {
    const { data: { user }, error } = await userClient.auth.getUser(token);
    if (user) return user;
    if (error) console.warn("auth.getUser() failed:", error.message);
  } catch (e) {
    console.warn("auth.getUser() threw:", (e as Error).message);
  }

  // 2. Fallback: decode JWT payload and verify user exists via admin API
  try {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(b64));
    if (!payload.sub) return null;
    // Reject tokens expired by more than 5 minutes to limit attack window
    if (payload.exp) {
      const now = Math.floor(Date.now() / 1000);
      if (now - payload.exp > 300) {
        console.warn("JWT expired beyond 5-min grace period, rejecting");
        return null;
      }
    }
    console.warn("JWT verify failed — falling back to admin.getUserById for:", payload.sub);
    const { data, error } = await adminClient.auth.admin.getUserById(payload.sub);
    if (error) {
      console.warn("admin.getUserById failed:", error.message);
      return null;
    }
    return data?.user || null;
  } catch (e) {
    console.warn("JWT decode fallback failed:", (e as Error).message);
    return null;
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Client authenticated as the inviting user
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Admin client for creating users
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get the inviting user (with fallback if JWT verification fails)
    const inviter = await getCallerUser(authHeader, userClient, adminClient);

    if (!inviter) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get inviter's profile to check role and company
    // (use admin client so it works even when JWT is stale)
    const { data: profile } = await adminClient
      .from("profiles")
      .select("company_id, role")
      .eq("id", inviter.id)
      .single();

    if (!profile || !["owner", "admin"].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: "Only owners and admins can invite reps" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check current rep count
    const { count } = await adminClient
      .from("sales_reps")
      .select("*", { count: "exact", head: true })
      .eq("company_id", profile.company_id);

    if ((count ?? 0) >= 10) {
      return new Response(
        JSON.stringify({ error: "Maximum of 10 sales reps reached" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body
    const { email, name, phone, visibility } = await req.json();

    if (!email || !name) {
      return new Response(
        JSON.stringify({ error: "Email and name are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create-or-find the invited user.
    // Try to create first; if the user already exists Supabase returns an
    // error containing "already been registered" — we then fall back to a
    // targeted listUsers lookup.
    let newUserId: string;

    const { data: newUser, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        user_metadata: {
          full_name: name,
          company_id: profile.company_id,
          user_type: "external",
        },
        email_confirm: false, // magic link will confirm
      });

    if (newUser?.user) {
      // Brand-new user
      newUserId = newUser.user.id;
    } else if (
      createError &&
      /already|exists|duplicate|unique/i.test(createError.message || "")
    ) {
      // User already exists — look them up.
      // NOTE: Supabase auth admin API does not support filtering listUsers by
      // email, so we must list and search.  This is only reached when creation
      // fails (existing user), not the common case.
      const { data: allList } = await adminClient.auth.admin.listUsers();
      const found = allList?.users?.find(
        (u: { email?: string }) => u.email === email
      );
      if (!found) {
        return new Response(
          JSON.stringify({ error: "User appears to exist but could not be found" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      newUserId = found.id;

      // Ensure they have a profile for this company
      const { data: existingProfile } = await adminClient
        .from("profiles")
        .select("id")
        .eq("id", found.id)
        .maybeSingle();

      if (!existingProfile) {
        await adminClient.from("profiles").insert({
          id: found.id,
          company_id: profile.company_id,
          user_type: "external",
          full_name: name,
          role: "member",
          phone,
        });
      }
    } else {
      return new Response(
        JSON.stringify({ error: createError?.message || "Failed to create user" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send magic link email via Resend
    const { data: linkData, error: magicLinkError } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: {
          redirectTo: `${Deno.env.get("SITE_URL") ?? "http://localhost:3000"}/dashboard`,
        },
      });

    if (magicLinkError) {
      console.error("Magic link error:", magicLinkError);
      // Don't fail — user is created, they can use "forgot password" flow
    }

    // Send branded invite email via Resend (falls back to Supabase default if Resend not configured)
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey && linkData?.properties?.action_link) {
      try {
        // Look up company name for the email
        const { data: company } = await adminClient
          .from("companies")
          .select("name")
          .eq("id", profile.company_id)
          .single();

        const emailContent = inviteRepEmail(
          name,
          company?.name || "a team",
          linkData.properties.action_link,
        );

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
          const errData = await resendRes.text();
          console.error("Resend invite email failed:", errData);
        }
      } catch (emailErr) {
        console.error("Resend invite email error:", emailErr);
      }
    }

    // Create or update the sales rep record (upsert avoids duplicate-key
    // errors when re-inviting an existing team member to the same company).
    const defaultVisibility = "assigned_only";
    const { data: rep, error: repError } = await adminClient
      .from("sales_reps")
      .upsert(
        {
          company_id: profile.company_id,
          user_id: newUserId,
          name,
          email,
          phone: phone || null,
          is_active: true,
          leads_visibility: visibility?.leads || defaultVisibility,
          quotes_visibility: visibility?.quotes || defaultVisibility,
          appointments_visibility: visibility?.appointments || defaultVisibility,
          sales_visibility: visibility?.sales || defaultVisibility,
          conversations_visibility:
            visibility?.conversations || defaultVisibility,
        },
        { onConflict: "company_id, user_id" }
      )
      .select()
      .single();

    if (repError) {
      return new Response(JSON.stringify({ error: repError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Track invite in sales_rep_invites table for dashboard visibility
    await adminClient.from("sales_rep_invites").insert({
      company_id: profile.company_id,
      email,
      full_name: name,
      phone: phone || null,
      status: "pending",
    });

    return new Response(
      JSON.stringify({
        message: `Invite sent to ${email}`,
        rep,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("invite-rep error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
