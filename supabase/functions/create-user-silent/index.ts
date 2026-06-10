import { createClient } from "npm:@supabase/supabase-js@2";

// ── Welcome email ─────────────────────────────────────────────────────────────
function maskPassword(pw: string): string {
  if (pw.length <= 3) return "***";
  return pw.slice(0, 3) + "*".repeat(Math.min(pw.length - 3, 8));
}

async function sendWelcomeEmail(
  resendApiKey: string,
  email: string,
  name: string,
  password: string,
  magicLink: string | null,
): Promise<void> {
  const loginSection = magicLink
    ? `<a href="${magicLink}"
         style="display:inline-block;background:#1f6fff;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;margin-bottom:16px">
         Click here to log in instantly &rarr;
       </a>
       <p style="margin:0 0 24px;font-size:12px;color:#9ca3af">
         This one-time login link expires in 24 hours. After that, use your email and password above.
       </p>`
    : `<a href="https://app.quoteleadshq.com/dashboard.html"
         style="display:inline-block;background:#1f6fff;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600">
         Log in to QuoteLeadsHQ
       </a>`;

  const loginText = magicLink
    ? `One-time login link (expires in 24h): ${magicLink}\n\nAfter it expires, log in at https://app.quoteleadshq.com/dashboard.html`
    : `Log in at https://app.quoteleadshq.com/dashboard.html`;

  const html = `
<html><body style="margin:0;padding:0;background:#f3f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:40px 20px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08)">
<tr><td style="background:#1f6fff;padding:24px 32px">
  <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600">QuoteLeadsHQ</h1>
</td></tr>
<tr><td style="padding:32px">
  <h2 style="margin:0 0 16px;font-size:18px;color:#111827">Your account is ready</h2>
  <p style="margin:0 0 16px;font-size:14px;color:#374151">Hi ${name},</p>
  <p style="margin:0 0 24px;font-size:14px;color:#374151">
    An account has been created for you on QuoteLeadsHQ. Your login details are below.
  </p>
  <table cellpadding="0" cellspacing="0" style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:24px;width:100%">
    <tr><td style="font-size:13px;color:#6b7280;padding-bottom:6px">Email</td></tr>
    <tr><td style="font-size:15px;color:#111827;font-weight:600;padding-bottom:14px">${email}</td></tr>
    <tr><td style="font-size:13px;color:#6b7280;padding-bottom:6px">Password</td></tr>
    <tr><td style="font-size:15px;color:#111827;font-weight:600;font-family:monospace">${maskPassword(password)}</td></tr>
  </table>
  <p style="margin:0 0 4px;font-size:13px;color:#6b7280">
    Your password starts with the characters shown above. For security, please change it after your first login via <strong>Settings → Change Password</strong>.
  </p>
  <p style="margin:0 0 16px;font-size:12px;color:#9ca3af">
    If you need your full password, contact the person who created your account.
  </p>
  ${loginSection}
</td></tr>
<tr><td style="padding:16px 32px;background:#f8f9fb;border-top:1px solid #e5e7eb">
  <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">
    QuoteLeadsHQ &mdash; All rights reserved.
  </p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const fromAddress =
    Deno.env.get("RESEND_FROM_EMAIL") ||
    "QuoteLeadsHQ <noreply@quoteleadshq.com>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [email],
      subject: "Your QuoteLeadsHQ account has been created",
      html,
      text: `Hi ${name},\n\nAn account has been created for you on QuoteLeadsHQ.\n\nEmail: ${email}\nPassword: starts with ${maskPassword(password)} — contact your admin for the full password.\n\nPlease change your password after your first login.\n\n${loginText}`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API returned HTTP ${res.status}: ${body}`);
  }
}

// ── CORS headers ──────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Verify caller JWT and resolve their auth.users record ─────────────────────
async function resolveCallerUser(
  authHeader: string,
  userClient: ReturnType<typeof createClient>,
) {
  const token = (authHeader || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const { data: { user }, error } = await userClient.auth.getUser(token);
    if (user) return user;
    if (error) console.warn("auth.getUser() failed:", error.message);
  } catch (e) {
    console.warn("auth.getUser() threw:", (e as Error).message);
  }
  return null;
}

// ── Keep sms_agent_config.twilio_number in step with twilio_numbers ──────────
// Fills the company's agent config with the assigned number, but never
// overwrites a number that is already configured.
async function syncAgentTwilioNumber(
  adminClient: ReturnType<typeof createClient>,
  companyId: string,
  phoneNumber: string,
): Promise<void> {
  try {
    const { data: cfg, error: cfgErr } = await adminClient
      .from("sms_agent_config")
      .select("id, twilio_number")
      .eq("company_id", companyId)
      .maybeSingle();
    if (cfgErr) {
      console.warn("syncAgentTwilioNumber lookup failed:", cfgErr.message);
      return;
    }
    if (cfg) {
      if (!cfg.twilio_number) {
        const { error: upErr } = await adminClient
          .from("sms_agent_config")
          .update({ twilio_number: phoneNumber })
          .eq("id", cfg.id);
        if (upErr) console.warn("syncAgentTwilioNumber update failed:", upErr.message);
      }
    } else {
      // Mirror provision_sms_for_company() defaults: inactive until configured.
      const { error: insErr } = await adminClient
        .from("sms_agent_config")
        .insert({
          company_id: companyId,
          name: "Default SMS Agent",
          auto_reply: false,
          is_active: false,
          lead_scoring_enabled: false,
          twilio_number: phoneNumber,
        });
      if (insErr) console.warn("syncAgentTwilioNumber insert failed:", insErr.message);
    }
  } catch (e) {
    console.warn("syncAgentTwilioNumber threw:", (e as Error).message);
  }
}

Deno.serve(async (req) => {
  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth header required ──────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    // ── Build two Supabase clients ────────────────────────────────────────────
    // userClient: runs as the calling user — used only for JWT validation.
    // adminClient: uses the service role key — NEVER returned to the client.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // ── Verify caller JWT ─────────────────────────────────────────────────────
    const caller = await resolveCallerUser(authHeader, userClient);
    if (!caller) {
      return json({ error: "Not authenticated" }, 401);
    }

    // ── Check is_admin flag ───────────────────────────────────────────────────
    // Queried via adminClient to bypass RLS and prevent privilege escalation.
    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("is_admin")
      .eq("id", caller.id)
      .maybeSingle();

    if (profileError) {
      console.error("Profile lookup error:", profileError.message);
      return json({ error: "Internal error checking admin status" }, 500);
    }

    if (!callerProfile?.is_admin) {
      return json({ error: "Forbidden: admin access required" }, 403);
    }

    // ── Parse and validate body ───────────────────────────────────────────────
    const body = await req.json().catch(() => ({})) as {
      email?: unknown;
      name?: unknown;
      password?: unknown;
      company_name?: unknown;
      company_phone?: unknown;
      company_email?: unknown;
      plan?: unknown;
      website_url?: unknown;
      service_area?: unknown;
      user_phone?: unknown;
      role?: unknown;
      twilio_number_id?: unknown;
      twilio_phone_number?: unknown;
    };

    const {
      email, name, password,
      company_name, company_phone, company_email,
      plan, website_url, service_area, user_phone, role,
      twilio_number_id, twilio_phone_number,
    } = body;

    if (!email || typeof email !== "string") {
      return json({ error: "email is required" }, 400);
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return json({ error: "name is required" }, 400);
    }
    if (name.trim().length > 120) {
      return json({ error: "name must be 120 characters or fewer" }, 400);
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return json({ error: "password must be at least 8 characters" }, 400);
    }
    if (password.length > 72) {
      return json({ error: "password must be 72 characters or fewer" }, 400);
    }

    const sanitizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizedEmail)) {
      return json({ error: "Invalid email address" }, 400);
    }

    // ── Create the user with a pre-set password ───────────────────────────────
    // email_confirm: true marks the address as verified immediately.
    // No invite, no magic-link, no email of any kind is sent.
    const { data: newUser, error: createError } =
      await adminClient.auth.admin.createUser({
        email: sanitizedEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: name.trim() },
      });

    if (createError || !newUser?.user) {
      console.error("createUser error:", createError?.message);
      return json(
        { error: createError?.message || "Failed to create user" },
        500,
      );
    }

    // ── Update company and profile with additional details ────────────────────
    // handle_new_user() trigger runs synchronously with the INSERT so the profile
    // and company rows exist immediately. Poll briefly for replication safety.
    const newUserId = newUser.user.id;
    let companyId: string | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 200));
      const { data: profileRow } = await adminClient
        .from("profiles")
        .select("company_id")
        .eq("id", newUserId)
        .maybeSingle();
      if (profileRow?.company_id) {
        companyId = profileRow.company_id;
        break;
      }
    }

    if (companyId) {
      const companyPatch: Record<string, unknown> = {};
      if (typeof company_name === "string" && company_name.trim()) {
        companyPatch.name = company_name.trim().slice(0, 200);
      }
      if (typeof company_phone === "string" && company_phone.trim()) {
        companyPatch.phone = company_phone.trim();
      }
      if (typeof company_email === "string" && company_email.trim()) {
        const ce = company_email.trim().toLowerCase();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ce)) companyPatch.email = ce;
      }
      if (plan === "managed" || plan === "ppl") {
        companyPatch.plan = plan as string;
      }
      if (typeof website_url === "string" && website_url.trim()) {
        companyPatch.website_url = website_url.trim();
      }
      if (typeof service_area === "string" && service_area.trim()) {
        companyPatch.service_area = service_area.trim();
      }
      if (Object.keys(companyPatch).length) {
        const { error: compErr } = await adminClient
          .from("companies")
          .update(companyPatch)
          .eq("id", companyId);
        if (compErr) console.warn("Company patch failed (non-fatal):", compErr.message);
      }

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let assignedTwilioPhone: string | null = null;
      if (typeof twilio_number_id === "string" && UUID_RE.test(twilio_number_id)) {
        const { data: tnRow, error: tnErr } = await adminClient
          .from("twilio_numbers")
          .update({ company_id: companyId })
          .eq("id", twilio_number_id)
          .select("phone_number")
          .maybeSingle();
        if (tnErr) console.warn("Twilio assignment failed (non-fatal):", tnErr.message);
        else assignedTwilioPhone = (tnRow?.phone_number as string) || null;
      } else if (
        typeof twilio_phone_number === "string" && twilio_phone_number.trim()
      ) {
        // Manual entry: assign the existing pool number if it matches, else
        // create a new twilio_numbers row owned by the new company.
        const phone = twilio_phone_number.trim().slice(0, 32);
        const { data: existingNums } = await adminClient
          .from("twilio_numbers")
          .select("id")
          .eq("phone_number", phone)
          .limit(1);
        if (existingNums && existingNums.length) {
          const { error: tnErr } = await adminClient
            .from("twilio_numbers")
            .update({ company_id: companyId })
            .eq("id", existingNums[0].id);
          if (tnErr) console.warn("Twilio assignment failed (non-fatal):", tnErr.message);
          else assignedTwilioPhone = phone;
        } else {
          const { error: tnErr } = await adminClient
            .from("twilio_numbers")
            .insert({ phone_number: phone, company_id: companyId });
          if (tnErr) console.warn("Twilio insert failed (non-fatal):", tnErr.message);
          else assignedTwilioPhone = phone;
        }
      }

      // Wire the assigned number into the company's SMS agent config so the
      // account is send-ready without a second manual step.
      if (assignedTwilioPhone) {
        await syncAgentTwilioNumber(adminClient, companyId, assignedTwilioPhone);
      }
    }

    const profilePatch: Record<string, unknown> = {};
    if (typeof user_phone === "string" && user_phone.trim()) {
      profilePatch.phone = user_phone.trim();
    }
    if (role === "owner" || role === "admin" || role === "member") {
      profilePatch.role = role as string;
    }
    if (Object.keys(profilePatch).length) {
      const { error: profErr } = await adminClient
        .from("profiles")
        .update(profilePatch)
        .eq("id", newUserId);
      if (profErr) console.warn("Profile patch failed (non-fatal):", profErr.message);
    }

    // ── Generate a one-time magic login link for the new user ─────────────────
    // This lets them click straight into the dashboard without typing credentials.
    // The link is single-use and expires automatically (Supabase default: 24h).
    let magicLink: string | null = null;
    try {
      const { data: linkData, error: linkErr } =
        await adminClient.auth.admin.generateLink({
          type: "magiclink",
          email: sanitizedEmail,
          options: { redirectTo: "https://app.quoteleadshq.com/dashboard.html" },
        });
      if (!linkErr && linkData?.properties?.action_link) {
        magicLink = linkData.properties.action_link;
      } else if (linkErr) {
        console.warn("Magic link generation failed (non-fatal):", linkErr.message);
      }
    } catch (e) {
      console.warn("Magic link generation threw (non-fatal):", (e as Error).message);
    }

    // ── Send welcome email with login credentials ──────────────────────────────
    // Awaited so the promise completes before the handler returns — Deno's
    // serverless runtime does not guarantee background tasks finish after the
    // response is sent. Email failure is non-fatal: the account is still created.
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      if (!resendApiKey) throw new Error("RESEND_API_KEY is not configured");
      await sendWelcomeEmail(
        resendApiKey,
        sanitizedEmail,
        name.trim(),
        password,
        magicLink,
      );
      emailSent = true;
    } catch (e) {
      emailError = (e as Error).message ?? String(e);
      console.warn("Welcome email failed (non-fatal):", emailError);
    }

    return json({
      user: {
        id: newUser.user.id,
        email: newUser.user.email,
      },
      email_sent: emailSent,
      email_error: emailError,
    });
  } catch (err) {
    console.error("create-user-silent unhandled error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
