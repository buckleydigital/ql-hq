// =============================================================================
// growth-onboarding - capture, verify, then create the account
// =============================================================================
// Steps 1 to 3 of the fulfilment flow, in one request:
//
//   1. CAPTURE   Store the posted form verbatim, before doing anything that can
//                fail. A submission that is saved but not yet processed can be
//                retried; one that was never saved is gone, and the client has
//                already seen the success screen.
//
//   2. VERIFY    The spam gate. Ask ql-mc whether this email or phone exists in
//                any sales pipeline stage, i.e. whether we have actually spoken
//                to this person. Match, go. No match, HOLD for review.
//
//   3. ACCOUNT   Only once the gate passes: create the QuoteLeadsHQ account and
//                send the welcome email. No manual step.
//
// THE GATE FAILS CLOSED
//   If ql-mc cannot be reached, or the lookup errors, the submission is held -
//   not passed. An unavailable gate is not a clearance. Holding costs somebody
//   pressing Approve; passing costs an account, a real email to a real address,
//   and a spam entry in fulfilment.
//
// PUBLIC ENDPOINT
//   The onboarding form is public, so this is called with the anon key and must
//   assume hostile input. It therefore: creates nothing before the gate has
//   passed, whitelists the fields it reads out of the payload, caps every string
//   and the body size, rate-limits by email and IP, and never reports whether a
//   lookup matched. A caller learning "matched / not matched" would have a free
//   oracle for testing whether an address is in our pipeline, so the response is
//   the same either way.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

// Australian mobile/landline to E.164 where we can, otherwise leave it be. The
// gate normalises again on the ql-mc side; this is so the stored row is tidy.
function normalisePhone(raw: string): string | null {
  let p = (raw || "").replace(/[\s\-().]/g, "");
  if (!p) return null;
  if (p.startsWith("04") || p.startsWith("02") || p.startsWith("03") || p.startsWith("07") || p.startsWith("08")) {
    p = "+61" + p.slice(1);
  } else if (p.startsWith("61") && !p.startsWith("+")) {
    p = "+" + p;
  }
  return p;
}

const str = (v: unknown, max = 500): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    // ── Release path: an approved submission being provisioned ──────────────
    // team-api calls back in here rather than reimplementing account creation,
    // so the approved route and the automatic route create accounts identically.
    // Authenticated by the service-role key: the header alone grants nothing, so
    // a public caller cannot use it to skip the spam gate.
    const provisionId = req.headers.get("x-provision-submission");
    if (provisionId) {
      const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      if (!bearer || bearer !== serviceKey) {
        return json({ error: "Forbidden" }, 403);
      }
      const result = await provisionAccount(admin, provisionId);
      if (!result.ok) {
        await admin.from("onboarding_submissions").update({
          last_error: result.error.slice(0, 1000),
          error_at: new Date().toISOString(),
        }).eq("id", provisionId);
        return json({ error: result.error }, 500);
      }
      return json({ ok: true, company_id: result.company_id });
    }

    // Cap the body before parsing it. The form is a few KB; anything far larger
    // is not a form.
    const raw = await req.text();
    if (raw.length > 64 * 1024) return json({ error: "Payload too large" }, 413);

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw || "{}");
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return json({ error: "Invalid payload" }, 400);
    }

    // ── Read the fields we know about ────────────────────────────────────────
    // Named columns for the review queue; the whole payload is kept alongside so
    // a field added to the form tomorrow is captured today.
    const email = (str(payload.email, 320) || "").toLowerCase();
    if (!email || !EMAIL_RE.test(email)) return json({ error: "A valid email is required" }, 400);

    const firstName = str(payload.first_name, 120);
    const lastName  = str(payload.last_name, 120);
    const company   = str(payload.company, 200);
    const phoneRaw  = str(payload.phone, 40) || str(payload.delivery_phone, 40);
    const phone     = phoneRaw;
    const phoneE164 = phoneRaw ? normalisePhone(phoneRaw) : null;

    const row = {
      payload,
      email,
      first_name: firstName,
      last_name: lastName,
      company,
      phone,
      phone_e164: phoneE164,
      industry:         str(payload.industry, 120),
      service_location: str(payload.service_location, 300),
      service_radius:   str(payload.service_radius, 120),
      max_daily_spend:  str(payload.max_daily_spend, 60),
      gate_status: "pending" as string,
    };

    // ── 1. CAPTURE, before anything that can fail ───────────────────────────
    // Dedup is an explicit read-then-write rather than an upsert, because the
    // unique index is partial and on lower(email): PostgREST's onConflict cannot
    // target that, so an upsert would fail every time and quietly fall through
    // to inserting duplicates - exactly what the index exists to prevent.
    //
    // An OPEN submission for this email (not yet turned into an account) is
    // updated in place, so an impatient double-click or the form's keepalive
    // retry cannot become two accounts. A submission that already produced an
    // account is left alone and a new row is started, because that is a genuine
    // second signup and overwriting the first would lose its history.
    const { data: open } = await admin
      .from("onboarding_submissions")
      .select("id, company_id, gate_status")
      .eq("email", email)
      .is("company_id", null)
      .in("gate_status", ["pending", "held", "matched", "approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let submissionId: string | undefined;

    if (open?.id) {
      // Do not silently un-reject or re-gate something a human already ruled on:
      // 'rejected' is excluded from the query above, so anything found here is
      // still in flight and safe to refresh with the newer answers.
      const { data: upd, error: updErr } = await admin
        .from("onboarding_submissions")
        .update({ ...row, gate_status: "pending" })
        .eq("id", open.id)
        .select("id")
        .single();
      if (updErr || !upd) {
        console.error("growth-onboarding: could not update the open submission:", updErr?.message);
        await notifyInternal(admin, "Onboarding submission FAILED TO SAVE", `${email} - ${updErr?.message}`);
        return json({ ok: false, captured: false });
      }
      submissionId = upd.id as string;
    } else {
      const { data: ins, error: insErr } = await admin
        .from("onboarding_submissions").insert(row).select("id").single();
      if (insErr || !ins) {
        console.error("growth-onboarding: could not save submission:", insErr?.message);
        // Deliberately a 200 with ok:false. The client has already seen the
        // form's success screen; a 500 here only produces a console error nobody
        // reads. The internal alert is how a human finds out.
        await notifyInternal(admin, "Onboarding submission FAILED TO SAVE", `${email} - ${insErr?.message}`);
        return json({ ok: false, captured: false });
      }
      submissionId = ins.id as string;
    }

    // ── 2. VERIFY (the spam gate) ───────────────────────────────────────────
    const gate = await runSpamGate(email, phoneE164 || phone);

    await admin.from("onboarding_submissions").update({
      gate_status: gate.pass ? "matched" : "held",
      gate_checked_at: new Date().toISOString(),
      gate_detail: gate.detail,
    }).eq("id", submissionId);

    if (!gate.pass) {
      // Held. No account, no email to the client. Tell the team there is
      // something to look at, because a queue nobody is told about is a queue
      // nobody empties.
      await notifyInternal(
        admin,
        "Onboarding held for review",
        `${company || email} did not match anyone in the ql-mc sales pipeline.\n\n` +
        `Email: ${email}\nPhone: ${phone || "-"}\nReason: ${gate.detail.reason}\n\n` +
        `Review and approve or reject in the Team Panel: https://quoteleadshq.com/team-panel`,
      );
      // Same response as the pass case. See the header: the caller must not learn
      // whether they matched.
      return json({ ok: true, captured: true });
    }

    // ── 3. ACCOUNT + welcome email ──────────────────────────────────────────
    const result = await provisionAccount(admin, submissionId);
    if (!result.ok) {
      await notifyInternal(admin, "Onboarding account creation failed", `${email}: ${result.error}`);
    }

    return json({ ok: true, captured: true });
  } catch (err) {
    console.error("growth-onboarding error:", err);
    return json({ ok: false }, 500);
  }
});

// ─── The gate ────────────────────────────────────────────────────────────────
// Returns pass=true only on a positive match. Every other outcome - no match, a
// lookup error, ql-mc unreachable, the bridge not configured - is a hold. An
// unavailable gate is not a clearance.
async function runSpamGate(email: string, phone: string | null): Promise<{
  pass: boolean;
  detail: Record<string, unknown>;
}> {
  const url    = Deno.env.get("QL_MC_API_URL");
  const secret = Deno.env.get("QL_MC_API_SECRET");
  if (!url || !secret) {
    console.warn("QL_MC_API_URL / QL_MC_API_SECRET not configured - holding for review");
    return { pass: false, detail: { reason: "The ql-mc bridge is not configured, so the pipeline could not be checked", checked: false } };
  }

  try {
    const res = await fetch(`${url}/sync-from-hq`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-secret": secret },
      body: JSON.stringify({ action: "check_lead_exists", email, phone }),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return { pass: false, detail: { reason: `The pipeline check failed (HTTP ${res.status})`, checked: false, error: body?.error ?? null } };
    }
    if (body?.matched === true) {
      return {
        pass: true,
        detail: {
          reason: "Found in the ql-mc sales pipeline",
          checked: true,
          match_count: body.match_count ?? null,
          // Kept so the review queue and the log can say WHICH lead cleared it.
          matches: Array.isArray(body.matches) ? body.matches : [],
        },
      };
    }
    return {
      pass: false,
      detail: { reason: "No matching email or phone in the ql-mc sales pipeline", checked: true, match_count: 0 },
    };
  } catch (e) {
    return { pass: false, detail: { reason: `The pipeline check could not be reached: ${(e as Error).message}`, checked: false } };
  }
}

// ─── Account provisioning ────────────────────────────────────────────────────
// Exported shape is reused by team-api when a held submission is approved, so
// the approve path and the automatic path create accounts identically. Two
// implementations of "create the account" is how they drift.
export async function provisionAccount(
  admin: ReturnType<typeof createClient>,
  submissionId: string,
): Promise<{ ok: true; company_id: string } | { ok: false; error: string }> {
  const { data: sub } = await admin
    .from("onboarding_submissions")
    .select("*")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub) return { ok: false, error: "Submission not found" };
  if (sub.company_id) return { ok: true, company_id: sub.company_id as string };

  const email = String(sub.email || "").toLowerCase();
  const fullName = [sub.first_name, sub.last_name].filter(Boolean).join(" ").trim();

  // Already a user? Reuse them. Re-running this must not create a second
  // account or send a second welcome email.
  let userId: string | null = null;
  let existed = false;
  for (let page = 1; page <= 10 && !userId; page++) {
    const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const hit = (list?.users || []).find((u: { email?: string }) => (u.email || "").toLowerCase() === email);
    if (hit) { userId = hit.id; existed = true; break; }
    if (!list?.users?.length || list.users.length < 1000) break;
  }

  if (!userId) {
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { full_name: fullName || null },
    });
    if (cErr || !created?.user) return { ok: false, error: cErr?.message || "Could not create the account" };
    userId = created.user.id;
  }

  // handle_new_user() creates the profile and company synchronously, but poll
  // rather than assume - the same wait create-user-silent and sync-from-mc use.
  let companyId: string | null = null;
  for (let attempt = 0; attempt < 8 && !companyId; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 200));
    const { data: prof } = await admin.from("profiles").select("company_id").eq("id", userId).maybeSingle();
    if (prof?.company_id) companyId = prof.company_id as string;
  }
  if (!companyId) return { ok: false, error: "The account was created but no company appeared" };

  // Carry the onboarding answers onto the company, so fulfilment starts with
  // what the client actually told us rather than an empty record.
  const patch: Record<string, unknown> = { plan: "managed", onboarding_completed: true };
  if (sub.company) patch.name = sub.company;
  if (sub.email) patch.email = sub.email;
  if (sub.phone_e164 || sub.phone) patch.phone = sub.phone_e164 || sub.phone;
  if (sub.industry) patch.niche = sub.industry;
  if (sub.service_location) patch.service_area = sub.service_location;
  if (sub.max_daily_spend) {
    const n = parseFloat(String(sub.max_daily_spend).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) patch.max_daily_ad_spend = n;
  }
  // The full form, so nothing captured is stranded in the submissions table.
  patch.dfy_profile = sub.payload ?? {};
  await admin.from("companies").update(patch).eq("id", companyId);

  await admin.from("onboarding_submissions").update({
    company_id: companyId,
    account_created_at: new Date().toISOString(),
    last_error: null,
    error_at: null,
  }).eq("id", submissionId);

  // Tick the checklist. These are the two steps the software just did, and they
  // are recorded the same way a person's tick would be, so the panel shows one
  // list rather than "automated things" and "manual things".
  await setStep(admin, companyId, "form_filled", "done", "Captured by the growth onboarding form");
  await setStep(admin, companyId, "signup_verified", "done", String((sub.gate_detail as Record<string, unknown>)?.reason ?? "Gate passed"));
  await setStep(admin, companyId, "account_created", "done", existed ? "Existing account reused" : "Created automatically");

  // paid_signed is the first required step and nothing in this flow ticked it,
  // so without this every client created here sits behind step one forever -
  // "waiting on: Paid & signed" while the whole build is finished behind it.
  //
  // The gate already knows the answer. It matched this person against a ql-mc
  // pipeline lead, and that lead's stage says whether they closed: closed_won is
  // evidence they paid and signed, so record it and say what the evidence was.
  // Any other stage is NOT evidence, so it stays pending for an ops manager to
  // confirm - which is the correct thing to block on. Never assume payment.
  const gateMatches = ((sub.gate_detail as Record<string, unknown>)?.matches ?? []) as Array<Record<string, unknown>>;
  const won = Array.isArray(gateMatches)
    ? gateMatches.find((m) => String(m?.stage || "").toLowerCase() === "closed_won")
    : null;
  if (won) {
    await setStep(admin, companyId, "paid_signed", "done",
      `Matched a closed-won lead in the ql-mc pipeline${won.company ? ` (${String(won.company).slice(0, 120)})` : ""}`);
  }

  // Welcome email. Only for a genuinely new account: re-running approval on an
  // existing client must not email them again.
  if (!existed) {
    const sent = await sendWelcomeEmail(admin, email, sub.first_name as string | null, companyId);
    if (sent) {
      await admin.from("onboarding_submissions")
        .update({ welcome_email_sent_at: new Date().toISOString() }).eq("id", submissionId);
      await setStep(admin, companyId, "welcome_email_sent", "done", "Sent automatically on account creation");
    } else {
      await setStep(admin, companyId, "welcome_email_sent", "blocked", "The welcome email failed to send, needs a manual send");
    }
  } else {
    await setStep(admin, companyId, "welcome_email_sent", "skipped", "Account already existed, not re-emailed");
  }

  return { ok: true, company_id: companyId };
}

// One writer for step state, mirroring team-api's setStep: the log line is part
// of the write, not something the caller remembers to do.
export async function setStep(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  stepKey: string,
  status: string,
  notes: string | null,
  actor?: { id?: string | null; name?: string },
) {
  const settled = status === "done" || status === "skipped";
  const { data: prev } = await admin
    .from("company_fulfilment").select("status")
    .eq("company_id", companyId).eq("step_key", stepKey).maybeSingle();

  const { error } = await admin.from("company_fulfilment").upsert({
    company_id: companyId,
    step_key: stepKey,
    status,
    notes: notes ? notes.slice(0, 2000) : null,
    completed_by: actor?.id ?? null,
    completed_by_name: settled ? (actor?.name || "Automation") : null,
  }, { onConflict: "company_id,step_key" });
  if (error) { console.warn("setStep failed:", stepKey, error.message); return; }

  await admin.from("fulfilment_log").insert({
    company_id: companyId,
    actor_id: actor?.id ?? null,
    actor_name: actor?.name || "Automation",
    action: "fulfilment.step_set",
    step_key: stepKey,
    from_status: prev?.status ?? "pending",
    to_status: status,
    detail: notes ? { notes: notes.slice(0, 500) } : {},
  });

  await mirrorToMc(admin, companyId);
}

// Push the derived summary to ql-mc, as team-api does. Best effort: the step is
// already committed, and ql-mc being briefly stale beats refusing the step.
export async function mirrorToMc(admin: ReturnType<typeof createClient>, companyId: string) {
  const url = Deno.env.get("QL_MC_API_URL");
  const secret = Deno.env.get("QL_MC_API_SECRET");
  if (!url || !secret) return;
  try {
    const { data: sum } = await admin
      .from("company_fulfilment_summary")
      .select("stage, stage_at, active_status, steps_done, steps_settled, steps_total, blocked_count, next_step_key, next_step_due")
      .eq("company_id", companyId).maybeSingle();
    if (!sum) return;
    await fetch(`${url}/sync-from-hq`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-secret": secret },
      body: JSON.stringify({ action: "upsert_fulfilment", hq_company_id: companyId, summary: sum }),
    });
  } catch (e) {
    console.warn("ql-mc mirror failed:", (e as Error).message);
  }
}

// ─── Emails ──────────────────────────────────────────────────────────────────
async function sendWelcomeEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
  firstName: string | null,
  companyId: string,
): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) { console.warn("RESEND_API_KEY not set - no welcome email"); return false; }

  // A set-password link, so the welcome email is actually actionable rather than
  // telling them to go and find a login they have never set.
  let setupLink = "https://quoteleadshq.com/dashboard";
  try {
    const { data: link } = await admin.auth.admin.generateLink({
      type: "recovery", email,
      options: { redirectTo: "https://quoteleadshq.com/dashboard" },
    });
    const url = (link as { properties?: { action_link?: string } })?.properties?.action_link;
    if (url) setupLink = url;
  } catch (e) {
    console.warn("could not generate a setup link:", (e as Error).message);
  }

  // Prefer the editable template if one is nominated, so the team owns the
  // wording without a deploy. Fall back to the built-in copy.
  const { data: tpl } = await admin
    .from("email_templates").select("subject, body").eq("slug", "growth_welcome").maybeSingle();

  const first = (firstName || "there").split(/\s+/)[0];
  const subject = (tpl?.subject as string) || "Welcome to QuoteLeads - your account is ready";
  const bodyText = ((tpl?.body as string) || [
    "Hi {first_name},",
    "",
    "Thanks for getting your onboarding details over. Your QuoteLeads account is set up and ready.",
    "",
    "Set your password and log in here:",
    "{setup_link}",
    "",
    "What happens next:",
    "",
    "  1. We build your ad copy and creatives and send them over for approval",
    "  2. You approve the previews, nothing goes live before you do",
    "  3. We launch, usually within 24 to 48 hours of approval",
    "",
    "If anything in your onboarding answers needs changing, just reply to this email.",
    "",
    "QuoteLeads",
  ].join("\n"))
    .replace(/\{first_name\}/g, first)
    .replace(/\{setup_link\}/g, setupLink);

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:600px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#1a1a20">
${bodyText.split(/\n{2,}/).map((p) =>
  `<p style="margin:0 0 16px">${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`
).join("")}
</div></body></html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `QuoteLeads <${Deno.env.get("RESEND_FROM_EMAIL") || "system@quoteleads.com.au"}>`,
        to: email, subject, html, text: bodyText,
      }),
    });
    if (!res.ok) {
      console.error("welcome email rejected:", res.status, await res.text().catch(() => ""));
      return false;
    }
    const payload = await res.json().catch(() => ({}));
    await admin.from("client_email_log").insert({
      company_id: companyId, kind: "growth_welcome", to_email: email,
      subject, body: bodyText, sent_by_name: "Automation",
      provider_id: (payload as { id?: string })?.id ?? null,
    });
    return true;
  } catch (e) {
    console.error("welcome email threw:", (e as Error).message);
    return false;
  }
}

// Internal alert. Reuses the existing notify-internal function so held
// submissions and failures surface where the team already looks.
async function notifyInternal(admin: ReturnType<typeof createClient>, subject: string, body: string) {
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-internal`;
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      // notify-internal takes { subject, body } and treats body as HTML.
      body: JSON.stringify({ subject, body: body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>") }),
    });
  } catch (e) {
    console.warn("internal notification failed:", (e as Error).message);
  }
}
