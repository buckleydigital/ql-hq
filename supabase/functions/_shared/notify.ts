// Email and checklist helpers for the preview rounds (creative-rounds and
// creative-approval). Importing this also loads the no-em-dash fetch wrapper,
// so nothing sent from here can carry a dash we never use.
import "./no-em-dash.ts";
import type { createClient } from "npm:@supabase/supabase-js@2";

type Admin = ReturnType<typeof createClient>;
type Row = Record<string, unknown>;

export const SITE = "https://quoteleadshq.com";

export async function sendEmail(to: string, subject: string, html: string, from = "QuoteLeads <onboarding@quoteleads.com.au>") {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, reply_to: "contact@quoteleads.com.au" }),
  }).catch(() => null);
  if (!res?.ok) console.error("email failed:", subject, res?.status, await res?.text().catch(() => ""));
  return !!res?.ok;
}

export const opsEmail = (subject: string, body: string) =>
  sendEmail("contact@quoteleads.com.au", subject,
    `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#333;line-height:1.7">${body}</div>`,
    "QuoteLeads System <system@quoteleads.com.au>");

/** A client email in the house style: greeting, a few paragraphs, one button. */
export function clientHtml(firstName: string, paragraphs: string[], button?: { label: string; url: string }) {
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a20;line-height:1.65;max-width:560px">
<p>Hi ${firstName},</p>
${paragraphs.map((p) => `<p>${p}</p>`).join("\n")}
${button ? `<p><a href="${button.url}" style="display:inline-block;background:#4797FF;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500">${button.label}</a></p>` : ""}
<p>The QuoteLeads team</p></div>`;
}

/** The owner's login email, which is who actually reads it; else the company's. */
export async function clientContact(admin: Admin, companyId: string): Promise<{ to: string | null; first: string }> {
  const { data: owner } = await admin.from("profiles").select("id, full_name").eq("company_id", companyId)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  let to: string | null = null;
  if (owner?.id) {
    const { data } = await admin.auth.admin.getUserById(owner.id as string);
    to = data?.user?.email ?? null;
  }
  if (!to) {
    const { data: co } = await admin.from("companies").select("email").eq("id", companyId).maybeSingle();
    to = (co?.email as string) || null;
  }
  const first = String(owner?.full_name || "").trim().split(/\s+/)[0] || "there";
  return { to, first };
}

/** Move a checklist step: the step, a log line and the Mission Control mirror. */
export async function setStep(admin: Admin, companyId: string, stepKey: string, status: string, notes: string,
  actor: { id: string | null; name: string }) {
  const settled = status === "done" || status === "skipped";
  const { data: prev } = await admin.from("company_fulfilment").select("status")
    .eq("company_id", companyId).eq("step_key", stepKey).maybeSingle();
  await admin.from("company_fulfilment").upsert({
    company_id: companyId, step_key: stepKey, status, notes: notes.slice(0, 2000),
    completed_by: settled ? actor.id : null, completed_by_name: settled ? actor.name : null,
  }, { onConflict: "company_id,step_key" });
  await admin.from("fulfilment_log").insert({
    company_id: companyId, actor_id: actor.id, actor_name: actor.name, action: "fulfilment.step_set",
    step_key: stepKey, from_status: (prev as Row | null)?.status ?? "pending", to_status: status, detail: { notes: notes.slice(0, 500) },
  });
  const url = Deno.env.get("QL_MC_API_URL"), secret = Deno.env.get("QL_MC_API_SECRET");
  if (!url || !secret) return;
  try {
    const { data: sum } = await admin.from("company_fulfilment_summary")
      .select("stage, stage_at, active_status, steps_done, steps_settled, steps_total, blocked_count, next_step_key, next_step_due")
      .eq("company_id", companyId).maybeSingle();
    const { data: co } = await admin.from("companies").select("is_test, ads_live_date").eq("id", companyId).maybeSingle();
    if (sum && !(co as Row | null)?.is_test) {
      await fetch(`${url}/sync-from-hq`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-api-secret": secret },
        body: JSON.stringify({ action: "upsert_fulfilment", hq_company_id: companyId, summary: sum, ads_live_date: (co as Row | null)?.ads_live_date ?? null }),
      });
    }
  } catch (e) {
    console.warn("ql-mc mirror failed:", (e as Error).message);
  }
}
