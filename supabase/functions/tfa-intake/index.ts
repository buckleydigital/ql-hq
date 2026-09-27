import { createClient } from "npm:@supabase/supabase-js@2";

// TFA Solar funnel -> ql-hq.
//
// TFA's own Supabase project (getaquotehq/tfa-funnels) fires this from an
// AFTER INSERT trigger on its `leads` table, posting the new row. We create the
// lead under the TFA Solar company, copy the uploaded electricity bill (if any)
// out of TFA's private `bills` bucket into our private `lead-files` bucket, and
// write the ql-hq lead id back onto TFA's row so re-sends are safe.
//
// Scoped to one client on purpose: the company is fixed here, the caller must
// present TFA_INTAKE_SECRET, and no welcome SMS is sent.
//
// Env: TFA_INTAKE_SECRET, TFA_SUPABASE_URL, TFA_SERVICE_ROLE_KEY

const TFA_COMPANY_ID = "501540f4-8464-44ec-a3bf-31365bfacde8";
const LEAD_SOURCE = "TFA Funnel";
const FILE_BUCKET = "lead-files";
const TFA_BILL_BUCKET = "bills";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Same normalisation as intake-lead, so SMS replies match the lead.
function toE164AU(p: string): string {
  const cleaned = p.replace(/[\s\-().]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("61")) return "+" + cleaned;
  if (cleaned.startsWith("0")) return "+61" + cleaned.slice(1);
  return "+" + cleaned;
}

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function str(v: unknown, max = 500): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  const expected = Deno.env.get("TFA_INTAKE_SECRET");
  const given = req.headers.get("x-intake-secret") || "";
  if (!expected || !safeEqual(given, expected)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  // Accept either the bare row or a Database Webhook style { record: row }.
  const row = (body && typeof body.record === "object" && body.record
    ? body.record
    : body) as Record<string, unknown> | null;

  const tfaLeadId = str(row?.id, 64);
  const name = str(row?.name, 120);
  if (!row || !tfaLeadId || !name) {
    return json({ success: false, error: "id and name are required" }, 400);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const tfaUrl = Deno.env.get("TFA_SUPABASE_URL");
  const tfaKey = Deno.env.get("TFA_SERVICE_ROLE_KEY");
  const tfa = tfaUrl && tfaKey ? createClient(tfaUrl, tfaKey) : null;
  if (!tfa) console.warn("TFA_SUPABASE_URL / TFA_SERVICE_ROLE_KEY not set - bill copy and write-back skipped");

  try {
    // Re-sends (backfill, retries) must not duplicate the lead.
    const { data: existing } = await db
      .from("leads")
      .select("id, metadata")
      .eq("company_id", TFA_COMPANY_ID)
      .eq("metadata->>tfa_lead_id", tfaLeadId)
      .limit(1)
      .maybeSingle();

    let leadId = existing?.id as string | undefined;
    let metadata = (existing?.metadata as Record<string, unknown>) || {};

    if (!leadId) {
      const phone = str(row.phone, 30);
      const email = str(row.email, 200);
      const firstName = name.split(" ")[0];
      const lastName = name.includes(" ") ? name.slice(name.indexOf(" ") + 1) : null;

      // Qualifying answers go in notes so they are readable on the lead and
      // survive edits from the dashboard (which rewrites custom_data).
      const answers: [string, unknown][] = [
        ["Interested in", row.interest],
        ["Existing solar", row.existing_solar],
        ["Quarterly bill", row.bill_range],
        ["Ownership", row.ownership],
        ["Timeframe", row.timeframe],
      ];
      const notes = answers
        .filter(([, v]) => str(v))
        .map(([k, v]) => `${k}: ${str(v)}`)
        .join("\n");

      metadata = {
        tfa_lead_id: tfaLeadId,
        tfa_source: str(row.source, 100),
        tracking: typeof row.tracking === "object" && row.tracking ? row.tracking : {},
      };

      const { data: lead, error } = await db
        .from("leads")
        .insert({
          company_id: TFA_COMPANY_ID,
          name,
          first_name: firstName,
          last_name: lastName,
          email: email ? email.toLowerCase() : null,
          phone: phone ? toE164AU(phone) : null,
          postcode: str(row.postcode, 10),
          source: LEAD_SOURCE,
          pipeline_stage: "new_lead",
          notes: notes || null,
          metadata,
          ai_enabled: false,
          created_at: str(row.created_at, 40) || new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error || !lead) {
        console.error("tfa-intake lead insert error:", error);
        return json({ success: false, error: "Failed to create lead" }, 500);
      }
      leadId = lead.id as string;
    }

    // Copy the bill across. The lead already exists, so a failure here only
    // costs the attachment, never the lead.
    const billPath = str(row.bill_path, 300);
    if (billPath && tfa && !metadata.bill) {
      try {
        const { data: file, error: dlErr } = await tfa.storage.from(TFA_BILL_BUCKET).download(billPath);
        if (dlErr || !file) throw dlErr || new Error("empty download");

        const ext = (billPath.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
        const dest = `${TFA_COMPANY_ID}/${leadId}/bill.${ext}`;
        const contentType = file.type || (ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}`);
        const { error: upErr } = await db.storage.from(FILE_BUCKET).upload(dest, file, {
          contentType,
          upsert: true,
        });
        if (upErr) throw upErr;

        metadata = {
          ...metadata,
          bill: {
            path: dest,
            filename: str(row.bill_filename, 200) || `bill.${ext}`,
            content_type: contentType,
            size: file.size,
          },
        };
        delete metadata.bill_error;
      } catch (err) {
        console.error("tfa-intake bill copy failed:", err);
        metadata = { ...metadata, bill_error: err instanceof Error ? err.message : String(err) };
      }
      await db.from("leads").update({ metadata }).eq("id", leadId);
    }

    // Mark TFA's row as synced so a backfill only re-sends what is missing.
    if (tfa && (!billPath || metadata.bill)) {
      const { error: wbErr } = await tfa
        .from("leads")
        .update({ qlhq_lead_id: leadId, qlhq_synced_at: new Date().toISOString() })
        .eq("id", tfaLeadId);
      if (wbErr) console.warn("tfa-intake write-back failed:", wbErr.message);
    }

    return json({ success: true, lead_id: leadId, bill_attached: !!metadata.bill });
  } catch (err) {
    console.error("tfa-intake error:", err);
    return json({ success: false, error: "Internal server error" }, 500);
  }
});
