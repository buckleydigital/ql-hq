// =============================================================================
// creative-approval - the client's preview page (quoteleadshq.com/approve.html)
// =============================================================================
// Public: the page's link carries the client's approval token
// (companies.approval_token), a 48-character secret made when their first
// round is sent. Nothing else identifies them, and the page only ever shows
// what the team has sent.
//
//   view    the latest ads sent to them, each as Meta renders it in every
//           placement (_shared/rounds.ts, the same previews the team checked);
//           or, once they've asked for changes, that their ads are being
//           updated
//   submit  their answer: every ad "looks good" or "change", with a comment
//           for each change. All good: Previews accepted is ticked and the
//           team told. Otherwise the autopilot (creative-rounds) revises.
//
// The page never shows how the ads are made, and never offers to edit them:
// the client says what they'd like, and the team comes back with it.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { roundPreviews } from "../_shared/rounds.ts";
import { viewUrl } from "../_shared/r2.ts";
import { opsEmail, setStep } from "../_shared/notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
type Row = Record<string, unknown>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// What a client can see: sent and answered rounds, never the team's work.
const CLIENT_VISIBLE = ["sent", "approved", "changes_requested"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({})) as Row;
    const token = String(body.token || "");
    if (!/^[0-9a-f]{48}$/.test(token)) return json({ error: "This link isn't valid" }, 404);
    const { data: company } = await admin.from("companies")
      .select("id, name, website_url, dfy_profile, approval_token").eq("approval_token", token).maybeSingle();
    if (!company) return json({ error: "This link isn't valid" }, 404);

    if (body.action === "view") return await view(admin, company as Row);
    if (body.action === "submit") return await submit(admin, company as Row, body);
    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("creative-approval error:", err);
    return json({ error: "Something went wrong. Please try again in a minute." }, 500);
  }
});

async function logoUrl(admin: ReturnType<typeof createClient>, companyId: string): Promise<string | null> {
  const { data } = await admin.from("company_assets").select("url, path, storage").eq("company_id", companyId).eq("kind", "logo").maybeSingle();
  if (!data) return null;
  return data.storage === "r2" ? await viewUrl(String(data.path)).catch(() => null) : String(data.url || "") || null;
}

async function view(admin: ReturnType<typeof createClient>, company: Row) {
  const { data: rounds } = await admin.from("creative_rounds").select("*").eq("company_id", company.id)
    .neq("status", "superseded").order("round", { ascending: false }).limit(10);
  const all = (rounds ?? []) as Row[];
  const shown = all.find((r) => CLIENT_VISIBLE.includes(String(r.status)));
  const business = { name: company.name, logo: await logoUrl(admin, String(company.id)) };
  if (!shown) return json({ business, state: "none" });

  // Asked for changes, and the team is on it: say so, show nothing half-made.
  if (shown.status === "changes_requested") return json({ business, state: "updating", decided_at: shown.decided_at });
  if (shown.status === "approved") return json({ business, state: "approved", decided_at: shown.decided_at });

  let ads;
  try {
    ads = await roundPreviews(admin, shown, company);
  } catch (e) {
    console.error("previews failed:", (e as Error).message);
    return json({ business, state: "unavailable" });
  }
  return json({
    business,
    state: "review",
    round: { id: shown.id, sent_at: shown.sent_at, note: ((shown.changes || {}) as Row).client ?? null, revised: Number(shown.round) > 1 },
    ads: ads.filter((a) => a.placements.length).map((a, i) => ({ key: a.key, number: i + 1, kind: a.kind, placements: a.placements })),
  });
}

async function submit(admin: ReturnType<typeof createClient>, company: Row, b: Row) {
  const { data: round } = await admin.from("creative_rounds").select("*").eq("id", String(b.round_id || ""))
    .eq("company_id", company.id).maybeSingle();
  if (!round || round.status !== "sent") return json({ error: "These ads have already been answered. Refresh the page to see the latest." }, 409);

  // Every ad the client was shown needs an answer, and a change needs a reason.
  const decisions = (b.decisions || {}) as Record<string, { decision?: string; comment?: string }>;
  const shownKeys = Object.keys(((round.previews || {}) as Row).items || {});
  const keys = shownKeys.length ? shownKeys : ((round.ads || []) as Row[]).map((a) => String(a.key));
  const clean: Record<string, { decision: string; comment: string }> = {};
  for (const k of keys) {
    const d = decisions[k];
    if (!d || (d.decision !== "approve" && d.decision !== "change")) return json({ error: "Let us know what you think of every ad." }, 400);
    const comment = String(d.comment || "").trim().slice(0, 1500);
    if (d.decision === "change" && !comment) return json({ error: "Tell us what you'd like changed on each ad you've marked." }, 400);
    clean[k] = { decision: d.decision, comment };
  }
  const general = String(b.general || "").trim().slice(0, 2000);
  const approved = Object.values(clean).every((d) => d.decision === "approve");
  const status = approved ? "approved" : "changes_requested";

  const { error } = await admin.from("creative_rounds").update({
    status, feedback: { ads: clean, general: general || null, submitted_at: new Date().toISOString() },
    decided_at: new Date().toISOString(),
  }).eq("id", round.id).eq("status", "sent");
  if (error) return json({ error: "Something went wrong. Please try again." }, 500);

  const client = { id: null, name: "Client" };
  if (approved) {
    await setStep(admin, String(company.id), "previews_accepted", "done",
      `Round ${round.round} approved by the client${general ? `: "${general.slice(0, 300)}"` : ""}`, client);
    await opsEmail(`✅ ${company.name} approved their ads`,
      `<p><strong>${company.name}</strong> approved round ${round.round} of their ads${general ? `, and said: "${general.replace(/</g, "&lt;")}"` : ""}.</p>` +
      `<p>Next: build the campaign in Meta.</p>`);
  } else {
    const n = Object.values(clean).filter((d) => d.decision === "change").length;
    await opsEmail(`✏️ ${company.name} asked for changes`,
      `<p><strong>${company.name}</strong> asked for changes to ${n} ad${n === 1 ? "" : "s"} in round ${round.round}.</p><ul>` +
      Object.entries(clean).filter(([, d]) => d.decision === "change")
        .map(([k, d]) => `<li><strong>${k}</strong>: ${d.comment.replace(/</g, "&lt;")}</li>`).join("") +
      (general ? `<li><strong>Overall</strong>: ${general.replace(/</g, "&lt;")}</li>` : "") +
      `</ul><p>The revision is being written and checked now; you'll get an email when it's ready to finish and send.</p>`);
  }
  return json({ ok: true, state: approved ? "approved" : "updating" });
}
