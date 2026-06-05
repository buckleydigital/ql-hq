import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ success: false, error: "Invalid JSON body" }, 400);
    }

    const {
      company_id,
      name,
      first_name,
      last_name,
      email,
      phone,
      postcode,
      source,
      niche,
      ownership_type,
      bill_range,
      purchase_timeline,
      matched_buyer,
      consent_text,
      ...rest
    } = body as Record<string, unknown>;

    if (!company_id || typeof company_id !== "string") {
      return json({ success: false, error: "company_id is required" }, 400);
    }

    const resolvedName: string | null =
      typeof name === "string" && name.trim()
        ? name.trim()
        : typeof first_name === "string" && first_name.trim()
        ? `${first_name.trim()}${
            typeof last_name === "string" && last_name.trim()
              ? " " + last_name.trim()
              : ""
          }`
        : null;

    if (!resolvedName) {
      return json(
        { success: false, error: "name or first_name is required" },
        400,
      );
    }

    const resolvedPhone =
      typeof phone === "string" && phone.trim() ? phone.trim() : null;
    const resolvedEmail =
      typeof email === "string" && email.trim()
        ? email.trim().toLowerCase()
        : null;

    if (!resolvedPhone && !resolvedEmail) {
      return json(
        { success: false, error: "phone or email is required" },
        400,
      );
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: company, error: companyErr } = await db
      .from("companies")
      .select("id")
      .eq("id", company_id)
      .single();

    if (companyErr || !company) {
      return json({ success: false, error: "Company not found" }, 404);
    }

    const resolvedFirstName =
      typeof first_name === "string" && first_name.trim()
        ? first_name.trim()
        : resolvedName.split(" ")[0];

    const resolvedLastName =
      typeof last_name === "string" && last_name.trim()
        ? last_name.trim()
        : resolvedName.includes(" ")
        ? resolvedName.slice(resolvedName.indexOf(" ") + 1)
        : null;

    const leadInsert: Record<string, unknown> = {
      company_id,
      name: resolvedName,
      first_name: resolvedFirstName,
      last_name: resolvedLastName,
      email: resolvedEmail,
      phone: resolvedPhone,
      postcode:
        typeof postcode === "string" && postcode.trim()
          ? postcode.trim()
          : null,
      pipeline_stage: "new_lead",
      source:
        typeof source === "string" && source.trim()
          ? source.trim()
          : "Landing Page",
      ai_enabled: true,
      created_at: new Date().toISOString(),
    };

    const customFieldsData: Record<string, unknown> = {};
    if (niche !== undefined) customFieldsData.niche = niche;
    if (ownership_type !== undefined)
      customFieldsData.ownership_type = ownership_type;
    if (bill_range !== undefined) customFieldsData.bill_range = bill_range;
    if (purchase_timeline !== undefined)
      customFieldsData.purchase_timeline = purchase_timeline;
    if (matched_buyer !== undefined)
      customFieldsData.matched_buyer = matched_buyer;
    if (consent_text !== undefined)
      customFieldsData.consent_text = consent_text;
    Object.assign(customFieldsData, rest);

    if (Object.keys(customFieldsData).length > 0) {
      leadInsert.custom_fields = customFieldsData;
    }

    let { data: lead, error: leadErr } = await db
      .from("leads")
      .insert(leadInsert)
      .select("id")
      .single();

    if (leadErr) {
      if (
        leadErr.message?.includes("custom_fields") ||
        leadErr.code === "42703"
      ) {
        delete leadInsert.custom_fields;
        const retry = await db
          .from("leads")
          .insert(leadInsert)
          .select("id")
          .single();
        lead = retry.data;
        if (retry.error) {
          console.error("Lead insert error (retry):", retry.error);
          return json({ success: false, error: "Failed to create lead" }, 500);
        }
      } else {
        console.error("Lead insert error:", leadErr);
        return json({ success: false, error: "Failed to create lead" }, 500);
      }
    }

    if (!lead) {
      return json({ success: false, error: "Failed to create lead" }, 500);
    }

    const leadId = lead.id as string;

    maybeSendWelcomeSms(
      db,
      company_id,
      leadId,
      resolvedFirstName,
      resolvedPhone,
    );

    maybeSendLeadDeliveryEmail(db, company_id, {
      name:   resolvedName,
      email:  resolvedEmail,
      phone:  resolvedPhone,
      niche:  typeof niche === "string" ? niche : null,
    });

    return json({ success: true, lead_id: leadId });
  } catch (err) {
    console.error("intake-lead error:", err);
    return json({ success: false, error: "Internal server error" }, 500);
  }
});

function maybeSendWelcomeSms(
  db: ReturnType<typeof createClient>,
  companyId: string,
  leadId: string,
  firstName: string,
  phone: string | null,
): void {
  if (!phone) return;

  (async () => {
    try {
      const { data: smsConfig } = await db
        .from("sms_agent_config")
        .select(
          "ai_enabled, auto_send_welcome, welcome_message, twilio_number",
        )
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(1)
        .single();

      if (!smsConfig) return;
      if (!smsConfig.ai_enabled) return;
      if (!smsConfig.auto_send_welcome) return;
      if (!smsConfig.twilio_number) return;

      const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
      if (!twilioSid || !twilioAuth) {
        console.warn("Twilio credentials not configured — skipping welcome SMS");
        return;
      }

      const { data: creditOk } = await db.rpc("deduct_sms_credit", {
        p_company_id: companyId,
      });
      if (!creditOk) {
        console.warn("No SMS credits for company:", companyId);
        return;
      }

      const template =
        typeof smsConfig.welcome_message === "string" &&
        smsConfig.welcome_message.trim()
          ? smsConfig.welcome_message
          : "Hi {{first_name}}, thanks for reaching out!";

      const messageBody = template.replace(/\{\{first_name\}\}/gi, firstName);

      const toE164AU = (p: string): string => {
        const cleaned = p.replace(/[\s\-().]/g, "");
        if (cleaned.startsWith("+")) return cleaned;
        if (cleaned.startsWith("61")) return "+" + cleaned;
        if (cleaned.startsWith("0")) return "+61" + cleaned.slice(1);
        return "+" + cleaned;
      };

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
      const twilioRes = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: toE164AU(phone),
          From: smsConfig.twilio_number,
          Body: messageBody,
        }).toString(),
      });

      if (!twilioRes.ok) {
        const errText = await twilioRes.text().catch(() => "");

        await db
          .rpc("refund_sms_credit", { p_company_id: companyId })
          .catch((e: unknown) =>
            console.warn(
              "Failed to refund SMS credit:",
              (e as Error).message,
            ),
          );

        console.warn(
          "Welcome SMS Twilio error:",
          twilioRes.status,
          errText,
        );
        return;
      }

      const { data: conv } = await db
        .from("conversations")
        .insert({
          company_id: companyId,
          lead_id: leadId,
          channel: "sms",
          is_open: true,
          last_message: messageBody,
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (conv?.id) {
        await db.from("messages").insert({
          conversation_id: conv.id,
          direction: "outbound",
          body: messageBody,
          channel: "sms",
          is_ai_generated: true,
          agent_type: "ai",
          metadata: { welcome: true },
        });
      }
    } catch (err) {
      console.warn("maybeSendWelcomeSms error:", err);
    }
  })();
}

function maybeSendLeadDeliveryEmail(
  db: ReturnType<typeof createClient>,
  companyId: string,
  lead: { name: string | null; email: string | null; phone: string | null; niche: string | null },
): void {
  (async () => {
    try {
      const { data: company } = await db
        .from("companies")
        .select("name, settings")
        .eq("id", companyId)
        .maybeSingle();

      const deliveryEmail = company?.settings?.lead_delivery?.email;
      if (!deliveryEmail) return;

      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      if (!resendApiKey) return;

      const niche = lead.niche
        ? lead.niche.charAt(0).toUpperCase() + lead.niche.slice(1)
        : "New";

      const html = `
        <div style="font-family:system-ui,sans-serif;font-size:14px;color:#333;line-height:1.7;max-width:560px">
          <h2 style="font-size:18px;margin:0 0 16px">🔔 New ${niche} Lead for ${company?.name || "your account"}</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#666;width:100px">Name</td><td style="padding:6px 0;font-weight:500">${lead.name || "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Phone</td><td style="padding:6px 0">${lead.phone || "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Email</td><td style="padding:6px 0">${lead.email || "—"}</td></tr>
            ${lead.niche ? `<tr><td style="padding:6px 0;color:#666">Niche</td><td style="padding:6px 0">${lead.niche}</td></tr>` : ""}
          </table>
          <p style="margin-top:20px;font-size:12px;color:#999">Log in to your QuoteLeads dashboard to view and action this lead.</p>
        </div>`;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "QuoteLeads <leads@quoteleads.com.au>",
          to: deliveryEmail,
          subject: `New ${niche} lead — ${lead.name || "Unknown"}`,
          html,
        }),
      });
    } catch (err) {
      console.warn("maybeSendLeadDeliveryEmail error:", err);
    }
  })();
}
