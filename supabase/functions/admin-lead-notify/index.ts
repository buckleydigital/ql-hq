// =============================================================================
// QuoteLeadsHQ - Admin: per-user new lead notification settings
// =============================================================================
// Used by the Edit User modal in /admin. Super-admins (profiles.is_admin) only.
//   action: get     { user_id }  -> settings, account email, last 10 sends
//   action: update  { user_id, enabled, channel, email, phone }
// Sending itself is done by lead-notify.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

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

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user: caller } } = await userClient.auth.getUser(token);
    if (!caller) return json({ error: "Not authenticated" }, 401);

    const { data: callerProfile } = await adminClient
      .from("profiles").select("is_admin").eq("id", caller.id).maybeSingle();
    if (!callerProfile?.is_admin) return json({ error: "Forbidden: admin access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const { action, user_id } = body as { action?: string; user_id?: string };
    if (!user_id || !UUID_RE.test(user_id)) return json({ error: "user_id must be a valid UUID" }, 400);

    if (action === "get") {
      const [{ data: p, error: pErr }, { data: u }, { data: log }] = await Promise.all([
        adminClient.from("profiles")
          .select("phone, lead_notify_enabled, lead_notify_channel, lead_notify_email, lead_notify_phone")
          .eq("id", user_id).maybeSingle(),
        adminClient.auth.admin.getUserById(user_id),
        adminClient.from("lead_notification_log")
          .select("channel, destination, status, response_body, created_at")
          .eq("profile_id", user_id)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      if (pErr) return json({ error: pErr.message }, 500);
      if (!p) return json({ error: "Profile not found" }, 404);
      return json({ settings: p, account_email: u?.user?.email ?? null, recent: log || [] });
    }

    if (action === "update") {
      const { enabled, channel, email, phone } = body as {
        enabled?: boolean; channel?: string; email?: string | null; phone?: string | null;
      };
      if (channel !== undefined && !["email", "sms", "email_sms"].includes(channel)) {
        return json({ error: "channel must be email, sms or email_sms" }, 400);
      }
      const cleanEmail = (email || "").trim();
      if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return json({ error: "Invalid notification email" }, 400);
      }
      const update: Record<string, unknown> = {
        lead_notify_email: cleanEmail || null,
        lead_notify_phone: (phone || "").trim() || null,
      };
      if (enabled !== undefined) update.lead_notify_enabled = !!enabled;
      if (channel !== undefined) update.lead_notify_channel = channel;
      const { error: upErr } = await adminClient.from("profiles").update(update).eq("id", user_id);
      if (upErr) return json({ error: upErr.message }, 500);
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("admin-lead-notify error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
