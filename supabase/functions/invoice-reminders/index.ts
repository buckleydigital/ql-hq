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
  return json({ ok: true, synced, told });
});
