// =============================================================================
// invoice-reminders - tell a client's VA when their invoice is due to go out
// =============================================================================
// Management runs in 30-day periods from the day the ads went live, and ql-mc
// holds the payment dates: it moves each one on every 30 days and drafts the
// invoice 7 days before it. Once a day, after ql-mc has drafted, this:
//
//   1. copies each client's next payment date onto companies.next_invoice_due,
//      which is what puts "Check & send invoice" on the Team Panel task list;
//   2. 7 days before the payment date, emails every team member assigned to
//      that client to go in, check the invoice and send it. Once per payment
//      date (invoice_reminders_sent), however many times this runs.
//
// While it runs each morning it also chases anyone who paid for a system on
// /buy-system but hasn't filled in the onboarding form (which is what creates
// their account): one reminder to them, and a heads-up to the office.
//
// pg_cron calls it with the autopilot secret; nothing else can.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { opsEmail, sendEmail, SITE } from "../_shared/notify.ts";

type Row = Record<string, unknown>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nice = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

Deno.serve(async (req: Request) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: ok } = await admin.rpc("autopilot_secret_ok", { p: req.headers.get("x-autopilot-secret") || "" });
  if (ok !== true) return json({ error: "unauthorized" }, 401);

  const mcUrl = Deno.env.get("QL_MC_API_URL"), mcSecret = Deno.env.get("QL_MC_API_SECRET");
  if (!mcUrl || !mcSecret) return json({ error: "Mission Control is not connected" }, 503);
  const res = await fetch(`${mcUrl}/sync-from-hq`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-api-secret": mcSecret },
    body: JSON.stringify({ action: "billing_schedule" }),
  });
  if (!res.ok) return json({ error: `Mission Control returned ${res.status}` }, 502);
  const { clients } = await res.json() as { clients: Row[] };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  const synced: string[] = [], told: string[] = [];

  for (const c of clients ?? []) {
    const cid = String(c.hq_company_id || ""), pay = String(c.next_payment_date || "");
    if (!cid || !/^\d{4}-\d{2}-\d{2}$/.test(pay)) continue;
    const { data: co } = await admin.from("companies").select("id, name, is_test, next_invoice_due").eq("id", cid).maybeSingle();
    if (!co || co.is_test) continue;

    if (co.next_invoice_due !== pay) {
      await admin.from("companies").update({ next_invoice_due: pay }).eq("id", cid);
      synced.push(String(co.name));
    }

    if (today < addDays(pay, -7) || today > pay) continue;
    const { error: dup } = await admin.from("invoice_reminders_sent").insert({ key: `invoice:${cid}:${pay}` });
    if (dup) continue; // already told for this payment date

    const { data: assigned } = await admin.from("team_assignments").select("team_user_id").eq("company_id", cid);
    const inv = c.invoice as Row | null;
    const what = inv
      ? `Invoice ${esc(inv.invoice_number)} for $${Number(inv.total || 0).toFixed(2)} has been drafted`
      : `Their invoice is being drafted`;
    const names: string[] = [];
    for (const a of (assigned ?? []) as Row[]) {
      const uid = String(a.team_user_id);
      const [{ data: p }, { data: u }] = await Promise.all([
        admin.from("profiles").select("full_name, is_team").eq("id", uid).maybeSingle(),
        admin.auth.admin.getUserById(uid),
      ]);
      const to = u?.user?.email;
      if (!p?.is_team || !to) continue;
      const first = String(p.full_name || "").trim().split(/\s+/)[0] || "there";
      await sendEmail(to, `Invoice to send: ${co.name}`,
        `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a20;line-height:1.65;max-width:560px">
<p>Hi ${esc(first)},</p>
<p><b>${esc(co.name)}</b>'s next management period starts ${nice(pay)}. ${what}.</p>
<p>Please open their page in the Team Panel, check the invoice and send it to them.</p>
<p><a href="${SITE}/team-panel?client=${cid}" style="display:inline-block;background:#4797FF;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500">Check &amp; send invoice</a></p>
</div>`, "QuoteLeads System <system@quoteleads.com.au>");
      names.push(String(p.full_name || to));
    }
    // Nobody assigned: it still has to go out, so the office hears instead.
    if (!names.length) {
      await opsEmail(`Invoice to send: ${co.name} (no VA assigned)`,
        `<p><b>${esc(co.name)}</b>'s next management period starts ${nice(pay)}. ${what}, and nobody is assigned to send it.</p>` +
        `<p><a href="${SITE}/team-panel?client=${cid}">Open them in the Team Panel</a></p>`);
    }
    await admin.from("fulfilment_log").insert({
      company_id: cid, actor_id: null, actor_name: "Automation", action: "invoice.reminder_sent",
      detail: { payment_date: pay, invoice_number: inv?.invoice_number ?? null, told: names },
    });
    told.push(`${co.name} (${names.join(", ") || "no VA assigned"})`);
  }
  const chased = await chaseUnonboarded(admin);
  return json({ ok: true, synced, told, chased });
});

// Paid on /buy-system at least 20 hours ago, still no onboarding form. Told
// once each; after that it is the office's call.
async function chaseUnonboarded(admin: ReturnType<typeof createClient>): Promise<string[]> {
  const { data: rows } = await admin.from("managed_purchases").select("stripe_session_id, email, metadata, created_at")
    .is("claimed_at", null).is("reminded_at", null).lt("created_at", new Date(Date.now() - 20 * 3600_000).toISOString());
  const out: string[] = [];
  for (const r of (rows ?? []) as Row[]) {
    const m = (r.metadata || {}) as Record<string, string>;
    const form = "https://quoteleads.com.au/growth-onboarding?" + new URLSearchParams({
      paid: "1", sid: String(r.stripe_session_id), first_name: m.first_name || "", last_name: m.last_name || "", company: m.company || "",
      phone: m.phone || "", email: String(r.email),
    }).toString();
    const first = (m.first_name || "").trim() || "there";
    await sendEmail(String(r.email), "One last step to start your build",
      `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a20;line-height:1.65;max-width:560px">
<p>Hi ${esc(first)},</p>
<p>Thanks again for coming on board${m.company ? ` with ${esc(m.company)}` : ""}. Before we can start building your system we need a few details about your business: your service area, budget and the jobs you want. It takes about 5 minutes.</p>
<p><a href="${form}" style="display:inline-block;background:#4797FF;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500">Fill in the onboarding form</a></p>
<p>As soon as it's in, your dashboard is set up and we get started.</p>
<p>The QuoteLeads team</p></div>`);
    await opsEmail(`Paid but not onboarded: ${m.company || r.email}`,
      `<p><strong>${esc(m.company || "(no company)")}</strong> paid for the ${esc(m.plan_label || "Branded Lead Gen System")} on ${nice(String(r.created_at).slice(0, 10))} and hasn't filled in the onboarding form, so they have no account yet. They've just been sent a reminder.</p>` +
      `<p>Email: ${esc(r.email)}<br>Phone: ${esc(m.phone || "-")}</p>`);
    await admin.from("managed_purchases").update({ reminded_at: new Date().toISOString() }).eq("stripe_session_id", r.stripe_session_id);
    out.push(String(m.company || r.email));
  }
  return out;
}
