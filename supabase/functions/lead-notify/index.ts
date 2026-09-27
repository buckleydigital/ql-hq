// =============================================================================
// QuoteLeadsHQ - New Lead Notifications
// =============================================================================
// Called by the on_lead_created_notify trigger (pg_net) for every new lead.
// Alerts each opted-in user of the lead's company by email (Resend), SMS
// (Twilio) or both, including every field that came in with the lead.
//
// Who gets notified: profiles in the lead's company with
// lead_notify_enabled = true. Owners/admins get every lead; other members
// only get leads assigned to them.
//
// Destinations: profiles.lead_notify_email / lead_notify_phone, falling back
// to the account's auth email / profiles.phone when blank.
//
// Deploy with --no-verify-jwt (the DB trigger may not hold a JWT). Abuse is
// bounded: only leads created in the last 30 minutes are processed, and
// lead_notification_log's unique (lead_id, profile_id, channel) key means each
// person is alerted at most once per lead per channel.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const MAX_LEAD_AGE_MS = 30 * 60 * 1000;
const SMS_MAX_CHARS = 1500; // Twilio hard limit is 1600

// Internal / system columns never shown to the client.
const HIDDEN_FIELDS = new Set([
  "id", "company_id", "assigned_to", "created_by", "updated_at",
  "status", "pipeline_stage", "pipeline_position",
  "ai_enabled", "ai_score", "ai_score_reason", "ai_status", "ai_summary",
  "sms_opted_out", "sms_opted_out_at", "is_ppl", "ppl_scrubbed",
  "first_name", "last_name", "name", // shown once as "Name"
  "custom_data", "metadata",         // flattened below
]);

// Internal keys inside custom_data / metadata (e.g. set by tfa-intake).
const HIDDEN_EXTRA_KEYS = new Set(["tfa_lead_id", "tracking", "bill", "bill_error"]);

// Preferred order for the common fields; everything else follows.
const FIELD_ORDER = [
  "phone", "email", "company", "address", "postcode", "service_type",
  "source", "value", "notes",
];

type Db = ReturnType<typeof createClient>;
type Lead = Record<string, unknown>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function labelise(k: string): string {
  return k.replace(/[_-]+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function display(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).trim();
}

function isBlank(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

// Normalise an AU number to E.164 (+61…). Anything else is passed through.
function toE164(raw: string): string | null {
  let p = (raw || "").replace(/[\s\-().]/g, "");
  if (!p) return null;
  if (p.startsWith("0") && p.length === 10) p = "+61" + p.slice(1);
  else if (p.startsWith("61") && p.length === 11) p = "+" + p;
  else if (p.startsWith("4") && p.length === 9) p = "+61" + p;
  return p.startsWith("+") ? p : null;
}

function formatAEST(iso: unknown): string {
  const d = iso ? new Date(String(iso)) : new Date();
  return d.toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function leadName(lead: Lead): string {
  const n = display(lead.name) ||
    [display(lead.first_name), display(lead.last_name)].filter(Boolean).join(" ");
  return n || "Unknown";
}

/** Every non-empty field on the lead as [label, value] pairs. */
function leadFields(lead: Lead): Array<[string, string]> {
  const out: Array<[string, string]> = [["Name", leadName(lead)]];
  const seen = new Set<string>(["name"]);

  const push = (key: string, value: unknown) => {
    if (isBlank(value)) return;
    if (key === "value" && Number(value) === 0) return;
    const label = labelise(key);
    if (seen.has(label.toLowerCase())) return;
    seen.add(label.toLowerCase());
    out.push([label, key === "created_at" ? formatAEST(value) : display(value)]);
  };

  for (const k of FIELD_ORDER) if (!HIDDEN_FIELDS.has(k)) push(k, lead[k]);
  for (const [k, v] of Object.entries(lead)) {
    if (HIDDEN_FIELDS.has(k) || FIELD_ORDER.includes(k) || k === "created_at") continue;
    push(k, v);
  }

  // Extra form answers live in custom_data / metadata.
  for (const bag of [lead.custom_data, lead.metadata]) {
    if (bag && typeof bag === "object" && !Array.isArray(bag)) {
      for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
        if (!HIDDEN_EXTRA_KEYS.has(k)) push(k, v);
      }
    }
  }

  push("created_at", lead.created_at);
  return out;
}

function buildEmail(lead: Lead, companyName: string, fields: Array<[string, string]>) {
  const row = (label: string, value: string) => {
    let v = esc(value);
    if (label === "Phone") v = `<a href="tel:${esc(value)}" style="color:#2563eb">${v}</a>`;
    else if (label === "Email") v = `<a href="mailto:${esc(value)}" style="color:#2563eb">${v}</a>`;
    return `<tr><td style="padding:6px 12px;color:#666666;font-size:13px;white-space:nowrap;vertical-align:top">${esc(label)}</td><td style="padding:6px 12px;color:#111111;font-weight:600;font-size:13px;word-break:break-word">${v.replace(/\n/g, "<br>")}</td></tr>`;
  };

  const subjectBits = [leadName(lead), display(lead.postcode), display(lead.service_type)].filter(Boolean);
  const subject = `New Lead - ${subjectBits.join(" · ")}`;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#ffffff">
  <div style="padding:14px 20px;border-bottom:1px solid #e5e5e5">
    <span style="color:#111111;font-weight:700;font-size:14px">New Lead · ${esc(companyName)}</span>
  </div>
  <table style="width:100%;border-collapse:collapse;background:#ffffff">${fields.map(([l, v]) => row(l, v)).join("")}</table>
  <div style="padding:16px 12px"><a href="https://quoteleadshq.com/dashboard.html" style="display:inline-block;background:#1f6fff;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 16px;border-radius:8px">View in QuoteLeadsHQ</a></div>
  <div style="padding:0 12px 16px;font-size:11px;color:#999999">You're receiving this because new-lead notifications are on for your QuoteLeadsHQ account. Change them under Settings → New Lead Notifications.</div>
</div></body></html>`;
  return { subject, html };
}

function buildSms(fields: Array<[string, string]>): string {
  const clean = (s: string) => s.replace(/[\x00-\x1F\x7F]/g, " ").replace(/\s+/g, " ").trim();
  let body = "New lead:";
  for (const [label, value] of fields) {
    const line = `\n${label}: ${clean(value)}`;
    if (body.length + line.length > SMS_MAX_CHARS) { body += "\n…more in QuoteLeadsHQ"; break; }
    body += line;
  }
  return body;
}

function resendFrom(): string {
  const f = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@quoteleadshq.com";
  return f.includes("<") ? f : `QuoteLeadsHQ <${f}>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: resendFrom(), to: [to], subject, html }),
  });
  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 500) };
}

async function sendSms(to: string, from: string, body: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!sid || !token) return { ok: false, status: 0, body: "Twilio credentials not configured" };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${sid}:${token}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 500) };
}

/** Claim the (lead, profile, channel) slot. Returns the log id, or null if already sent. */
async function claim(db: Db, lead: Lead, profileId: string, channel: string, destination: string | null) {
  const { data, error } = await db.from("lead_notification_log")
    .upsert({
      lead_id: lead.id, company_id: lead.company_id, profile_id: profileId,
      channel, destination, status: "sending",
    }, { onConflict: "lead_id,profile_id,channel", ignoreDuplicates: true })
    .select("id");
  if (error) { console.error("lead_notification_log claim:", error.message); return null; }
  return data?.[0]?.id ?? null;
}

async function finish(db: Db, logId: string, status: string, code: number | null, body: string) {
  await db.from("lead_notification_log")
    .update({ status, response_code: code, response_body: body.slice(0, 500) })
    .eq("id", logId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { lead_id } = await req.json().catch(() => ({}));
    if (!lead_id || typeof lead_id !== "string") return json({ error: "lead_id required" }, 400);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: lead } = await db.from("leads").select("*").eq("id", lead_id).maybeSingle();
    if (!lead) return json({ error: "lead not found" }, 404);
    if (Date.now() - new Date(lead.created_at as string).getTime() > MAX_LEAD_AGE_MS) {
      return json({ skipped: "lead too old" });
    }

    const { data: recipients } = await db.from("profiles")
      .select("id, role, phone, is_active, lead_notify_enabled, lead_notify_channel, lead_notify_email, lead_notify_phone")
      .eq("company_id", lead.company_id)
      .eq("lead_notify_enabled", true);

    const targets = (recipients || []).filter((p) =>
      p.is_active !== false &&
      (["owner", "admin"].includes(p.role || "") || p.id === lead.assigned_to)
    );
    if (!targets.length) return json({ skipped: "no recipients" });

    const [{ data: company }, { data: platform }] = await Promise.all([
      db.from("companies").select("name").eq("id", lead.company_id).maybeSingle(),
      db.from("platform_settings").select("shared_ppl_twilio_number").eq("id", 1).maybeSingle(),
    ]);
    const smsFrom = Deno.env.get("LEAD_NOTIFY_SMS_FROM") ||
      platform?.shared_ppl_twilio_number || Deno.env.get("TWILIO_FROM_NUMBER") || "";

    const fields = leadFields(lead);
    const { subject, html } = buildEmail(lead, company?.name || "QuoteLeadsHQ", fields);
    const smsBody = buildSms(fields);

    const results: Array<Record<string, unknown>> = [];

    await Promise.all(targets.map(async (p) => {
      const channel = p.lead_notify_channel || "email";
      const wantEmail = channel === "email" || channel === "email_sms";
      const wantSms = channel === "sms" || channel === "email_sms";

      if (wantEmail) {
        let to = (p.lead_notify_email || "").trim();
        if (!to) {
          const { data: u } = await db.auth.admin.getUserById(p.id);
          to = u?.user?.email || "";
        }
        const logId = await claim(db, lead, p.id, "email", to || null);
        if (logId) {
          if (!to) {
            await finish(db, logId, "skipped", null, "no email address");
          } else {
            const r = await sendEmail(to, subject, html);
            await finish(db, logId, r.ok ? "sent" : "failed", r.status, r.body);
            results.push({ profile_id: p.id, channel: "email", ok: r.ok });
          }
        }
      }

      if (wantSms) {
        const to = toE164(p.lead_notify_phone || p.phone || "");
        const logId = await claim(db, lead, p.id, "sms", to);
        if (logId) {
          if (!to) await finish(db, logId, "skipped", null, "no valid phone number");
          else if (!smsFrom) await finish(db, logId, "failed", null, "no Twilio sender number configured");
          else {
            const r = await sendSms(to, smsFrom, smsBody);
            await finish(db, logId, r.ok ? "sent" : "failed", r.status, r.body);
            results.push({ profile_id: p.id, channel: "sms", ok: r.ok });
          }
        }
      }
    }));

    return json({ success: true, lead_id, results });
  } catch (err) {
    console.error("lead-notify error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
