// =============================================================================
// no-answer-followups - follow up clients' leads they couldn't reach
// =============================================================================
// A lead a client moves to No Answer gets a text and an email on day 1, 3, 7
// and 10 after the move, for clients who have switched it on (Pipeline page,
// sms_agent_config.no_answer_*). The text goes from the client's own number
// and uses their SMS credits; the email goes in the client's name, and replies
// go to them. Moving the lead out of No Answer, or the lead texting back,
// stops it.
//
// Each step goes on its day, or the day after if a morning was missed, and
// never later, so switching it on, or a lead left in No Answer for weeks,
// never sends a backlog. Every attempt is recorded in no_answer_followup_log,
// sent or not, so nothing goes twice and a lead with no mobile isn't tried
// again every morning. A lead who has opted out of texts (STOP) gets none.
//
// POST {} with x-autopilot-secret (pg_cron, each morning), or
// { "dry_run": true } to see what would go without sending anything.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import "../_shared/no-em-dash.ts";

type Row = Record<string, unknown>;
type Step = { day: number; sms?: string; subject?: string; email?: string };

// What a client starts with; they can change every word.
export const DEFAULT_STEPS: Step[] = [
  {
    day: 1,
    sms: "Hi {{first_name}}, it's {{business_name}}. We tried calling about your enquiry. When's a good time for a quick chat?",
    subject: "Sorry we missed you, {{first_name}}",
    email: "Hi {{first_name}},\n\nThanks for your enquiry. We tried giving you a call but couldn't catch you.\n\nWhat's a good time to chat? Just reply with a time that suits and we'll call you then.\n\n{{business_name}}",
  },
  {
    day: 3,
    sms: "Hi {{first_name}}, {{business_name}} here following up on your enquiry. Reply with a time that suits and we'll give you a call.",
    subject: "Following up on your enquiry",
    email: "Hi {{first_name}},\n\nJust following up on your enquiry. We've tried calling but haven't been able to reach you.\n\nIf you reply with a day and time that suits, we'll call you then.\n\n{{business_name}}",
  },
  {
    day: 7,
    sms: "Hi {{first_name}}, are you still after help with your enquiry? Reply YES and {{business_name}} will give you a call.",
    subject: "Still need a hand, {{first_name}}?",
    email: "Hi {{first_name}},\n\nWe didn't want your enquiry to slip through the cracks. Are you still looking for help?\n\nJust reply YES and we'll give you a call to sort out the details.\n\n{{business_name}}",
  },
  {
    day: 10,
    sms: "Hi {{first_name}}, last message from {{business_name}}. If you'd still like a quote, just reply and we'll be in touch.",
    subject: "Should we close off your enquiry?",
    email: "Hi {{first_name}},\n\nWe've tried to reach you a few times about your enquiry, so this will be our last email.\n\nIf you'd still like a quote, just reply and we'll call you whenever suits. Otherwise, all the best.\n\n{{business_name}}",
  },
];

const OPT_OUT = "Reply STOP to opt out";
const withOptOut = (msg: string) => /\bstop\b/i.test(msg) ? msg : `${msg}\n\n${OPT_OUT}`;

function merge(text: string, vals: Record<string, string>): string {
  return String(text || "")
    .replace(/\{\{\s*(first_name|business_name)\s*\}\}/g, (_, k) => vals[k] || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHtml = (text: string) =>
  `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a20;line-height:1.65;max-width:560px">${
    text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("")
  }</div>`;

// Days between two moments on Sydney's calendar: moved at 4pm, day 1 is the
// next morning.
const sydneyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const daysBetween = (from: Date, to: Date) => Math.round((Date.parse(sydneyDay(to)) - Date.parse(sydneyDay(from))) / 86400e3);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });
  const { data: ok } = await admin.rpc("autopilot_secret_ok", { p: req.headers.get("x-autopilot-secret") || "" });
  if (ok !== true) return json({ error: "unauthorized" }, 401);
  const dryRun = (await req.json().catch(() => ({})) as Row).dry_run === true;

  const { data: configs } = await admin.from("sms_agent_config")
    .select("company_id, twilio_number, no_answer_sms, no_answer_email, no_answer_messages")
    .eq("no_answer_enabled", true);
  if (!configs?.length) return json({ ok: true, message: "No client has no-answer follow-ups on" });

  const since = new Date(Date.now() - 12 * 86400e3).toISOString();
  const results: Row[] = [];
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID"), twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromAddress = (Deno.env.get("RESEND_FROM_EMAIL") || "noreply@quoteleadshq.com").match(/[^<\s]+@[^>\s]+/)?.[0] || "noreply@quoteleadshq.com";
  const now = new Date();

  for (const cfg of configs) {
    const companyId = String(cfg.company_id);
    const steps = (Array.isArray(cfg.no_answer_messages) && cfg.no_answer_messages.length ? cfg.no_answer_messages : DEFAULT_STEPS) as Step[];
    const { data: leads } = await admin.from("leads")
      .select("id, first_name, name, email, phone, sms_opted_out, pipeline_stage_changed_at, last_inbound_at")
      .eq("company_id", companyId).eq("pipeline_stage", "no_answer")
      .gte("pipeline_stage_changed_at", since).limit(200);
    if (!leads?.length) continue;

    const { data: company } = await admin.from("companies").select("name, email").eq("id", companyId).maybeSingle();
    const businessName = String((company as Row | null)?.name || "").trim();
    let replyTo = String((company as Row | null)?.email || "").trim();
    if (!replyTo) {
      const { data: owner } = await admin.from("profiles").select("id").eq("company_id", companyId)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (owner?.id) replyTo = (await admin.auth.admin.getUserById(String(owner.id))).data?.user?.email || "";
    }
    const { data: done } = await admin.from("no_answer_followup_log")
      .select("lead_id, entered_at, step_day, channel").in("lead_id", leads.map((l) => l.id));
    const seen = new Set((done || []).map((d) => `${d.lead_id}|${Date.parse(String(d.entered_at))}|${d.step_day}|${d.channel}`));

    for (const lead of leads) {
      const entered = new Date(String(lead.pipeline_stage_changed_at));
      // They've texted back since: they're reachable, so stop.
      if (lead.last_inbound_at && new Date(String(lead.last_inbound_at)) > entered) continue;
      const day = daysBetween(entered, now);
      const step = steps.find((s) => Number(s.day) === day) || steps.find((s) => Number(s.day) + 1 === day);
      if (!step) continue;

      const vals = {
        first_name: String(lead.first_name || String(lead.name || "").split(/\s+/)[0] || "").trim(),
        business_name: businessName,
      };
      const key = (ch: string) => `${lead.id}|${entered.getTime()}|${step.day}|${ch}`;
      const record = async (channel: string, sent: boolean, detail: string | null) => {
        results.push({ company: businessName, lead_id: lead.id, day: step.day, channel, ok: sent, ...(detail ? { detail } : {}) });
        if (dryRun) return;
        await admin.from("no_answer_followup_log").upsert({
          company_id: companyId, lead_id: lead.id, entered_at: entered.toISOString(), step_day: step.day, channel, ok: sent, detail,
        }, { onConflict: "lead_id,entered_at,step_day,channel", ignoreDuplicates: true });
      };

      // The email, in the client's name.
      if (cfg.no_answer_email && step.subject && step.email && !seen.has(key("email"))) {
        const to = String(lead.email || "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(to)) await record("email", false, "no email address");
        else if (dryRun) await record("email", true, `would email ${to}`);
        else if (!resendKey) await record("email", false, "email is not configured");
        else {
          const body = merge(step.email, vals);
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `${(businessName || "QuoteLeads").replace(/[<>"]/g, "")} <${fromAddress}>`, to,
              subject: merge(step.subject, vals), html: toHtml(body), text: body,
              ...(replyTo ? { reply_to: replyTo } : {}),
            }),
          }).catch(() => null);
          await record("email", !!res?.ok, res?.ok ? null : `email provider: ${res ? res.status : "unreachable"}`);
        }
      }

      // The text, from the client's number.
      if (cfg.no_answer_sms && step.sms && !seen.has(key("sms"))) {
        const phone = String(lead.phone || "").trim();
        if (!phone) { await record("sms", false, "no phone number"); continue; }
        if (!cfg.twilio_number) { await record("sms", false, "the client has no SMS number"); continue; }
        const { data: optedOut, error: optErr } = await admin.rpc("sms_is_opted_out", { p_company_id: companyId, p_phone: phone });
        if (lead.sms_opted_out || optedOut === true || optErr) { await record("sms", false, optErr ? "couldn't check opt-outs" : "opted out of SMS"); continue; }
        if (dryRun) { await record("sms", true, `would text ${phone}`); continue; }
        if (!twilioSid || !twilioAuth) { await record("sms", false, "SMS is not configured"); continue; }
        const { data: credit } = await admin.rpc("deduct_sms_credit", { p_company_id: companyId });
        if (!credit) { await record("sms", false, "no SMS credits"); continue; }
        const message = withOptOut(merge(step.sms, vals));
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
          method: "POST",
          headers: { Authorization: `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ To: phone, From: String(cfg.twilio_number), Body: message }).toString(),
        }).catch(() => null);
        if (!res?.ok) {
          await admin.rpc("refund_sms_credit", { p_company_id: companyId });
          await record("sms", false, `SMS provider: ${res ? res.status : "unreachable"}`);
          continue;
        }
        await record("sms", true, null);
        // In the lead's conversation, so the client sees it in their inbox.
        const { data: conv } = await admin.from("conversations").select("id")
          .eq("lead_id", lead.id).eq("company_id", companyId).maybeSingle();
        if (conv) {
          await admin.from("messages").insert({ conversation_id: conv.id, direction: "outbound", body: message, is_ai_generated: false, agent_type: null });
        }
        await admin.from("leads").update({ last_outbound_at: new Date().toISOString() }).eq("id", lead.id);
      }
    }
  }

  return json({ ok: true, dry_run: dryRun, sent: results.filter((r) => r.ok).length, results });
});
