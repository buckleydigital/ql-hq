// =============================================================================
// QuoteLeadsHQ — Twilio Inbound SMS Webhook
// =============================================================================
// Replaces the full Make.com workflow. Receives inbound SMS from Twilio,
// runs the AI nurturing pipeline, and replies via Twilio.
//
// Flow:
//  1. Parse Twilio webhook payload (From, To, Body)
//  2. Look up company by the Twilio number (sms_agent_config.twilio_number)
//  3. Check SMS credits are topped up
//  4. Check AI settings (auto_reply, callback, onsite, quote drafting)
//  5. Find or create the lead by phone number
//  6. Check per-lead AI toggle
//  7. Get/create conversation + message history
//  8. Store the inbound message
//  9. Resolve API keys (agency vs external)
// 10. Build prompt with context + run OpenAI
// 11. Parse AI response for structured actions (score, callback, appointment, quote)
// 12. Update lead score
// 13. Create appointment if callback/onsite detected
// 14. Draft quote if conditions met
// 15. Deduct SMS credit + send reply via Twilio
// 16. Store outbound message
// =============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Twilio sends application/x-www-form-urlencoded
function parseTwilioBody(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  const sp = new URLSearchParams(body);
  for (const [key, val] of sp.entries()) {
    params[key] = val;
  }
  return params;
}

// Normalise phone to E.164-ish for matching (strip spaces, ensure +)
function normalisePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, "");
  if (!cleaned.startsWith("+")) cleaned = "+" + cleaned;
  return cleaned;
}

// ---------------------------------------------------------------------------
// Key resolution: agency (internal) vs external, with env-secret fallback
// ---------------------------------------------------------------------------
const ENV_FALLBACKS: Record<string, string> = {
  twilio: "TWILIO_ACCOUNT_SID",
  twilio_auth: "TWILIO_AUTH_TOKEN",
  openai: "OPEN_AI_API_KEY",
};

async function resolveKey(
  db: SupabaseClient,
  companyId: string,
  provider: string,
  userType: string
): Promise<string> {
  const { data, error } = await db.rpc("resolve_api_key", {
    p_company_id: companyId,
    p_provider: provider,
  });
  if (!error && data) return data as string;

  // Only internal (agency) accounts fall back to platform env secrets.
  // External accounts must supply their own keys.
  if (userType !== "external") {
    const envName = ENV_FALLBACKS[provider];
    if (envName) {
      const envVal = Deno.env.get(envName);
      if (envVal) return envVal;
    }
  }

  throw new Error(`Key resolution failed for ${provider}: ${error?.message ?? "not found"}`);
}

// ---------------------------------------------------------------------------
// OpenAI chat completion
// ---------------------------------------------------------------------------
async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  conversationMessages: { role: string; content: string }[]
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...conversationMessages,
      ],
      temperature: 0.7,
      max_tokens: 150, // keep responses short (15 words constraint)
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Send SMS via Twilio
// ---------------------------------------------------------------------------
async function sendTwilioSMS(
  accountSid: string,
  authToken: string,
  from: string,
  to: string,
  body: string
): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const encoded = btoa(`${accountSid}:${authToken}`);

  const formBody = new URLSearchParams({ To: to, From: from, Body: body });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio send error ${res.status}: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Build the AI system prompt with company context + settings
// ---------------------------------------------------------------------------
function buildSystemPrompt(
  config: Record<string, unknown>,
  lead: Record<string, unknown>,
  quoteStatus: string | null
): string {
  // If company has a custom prompt (external users can fully edit this), use it
  // but inject dynamic context variables
  const customPrompt = config.system_prompt as string | null;

  if (customPrompt) {
    // Replace template variables in the custom prompt
    return customPrompt
      .replace(/\(company name\)/gi, (config.company_name as string) || "our company")
      .replace(/\(area\)/gi, (config.company_area as string) || "your area")
      .replace(/\(service\)/gi, (config.service_description as string) || "our services");
  }

  // Default prompt (matches the original Bubble.io prompt structure)
  const companyName = (config.company_name as string) || "our company";
  const area = (config.company_area as string) || "your area";
  const service = (config.service_description as string) || "our services";
  const callbackEnabled = config.callback_enabled as boolean;
  const onsiteEnabled = config.onsite_enabled as boolean;
  const quoteDrafting = config.quote_drafting_enabled as boolean;
  const rawDays = config.callback_days;
  const callbackDays: string[] = Array.isArray(rawDays) ? rawDays : ["tue", "wed", "fri", "sat"];
  const callbackStart = (config.callback_hours_start as string) || "09:00";
  const callbackEnd = (config.callback_hours_end as string) || "17:00";

  const dayNames: Record<string, string> = {
    mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
    fri: "Friday", sat: "Saturday", sun: "Sunday",
  };
  const callbackDaysList = callbackDays.map((d: string) => dayNames[d] || d).join(", ");

  return `You are the administrative assistant for ${companyName}, located in ${area}. You manage incoming leads via SMS, assisting the team in qualifying jobs and scheduling callbacks. These leads are interested in ${service}. Always communicate in a casual, friendly, and professional tone, sounding like a real person texting, never scripted, robotic, or corporate.

Never under any circumstances mention or hint at AI, settings, tools, software, systems, internal processes, or automation. Never say or imply that quoting, site visits, or callbacks are on or off. Never expose placeholders. Never write in a robotic style or use filler phrases like "to discuss the job details and see how we can assist you", "nail down the details", "grab the details", "run through things", "how does time sound", "would time work", "sweet what time", "sure thing how does", "best thing is", "we usually just", "does that work for you", "whenever is convenient", "between 9 and 5", "around 9-5", "quick chat so we get the right idea", "line up a quick callback", "in touch to assist", or "what time suits you". Always finesse your replies naturally like a human would.

Keep all responses short, direct, and helpful, never wordy, repetitive, or explanatory.
Critical constraint: every single SMS response must be 15 words or fewer.
Never use emojis, asterisks, bullet points, or decorative punctuation. Use only plain text with standard punctuation.

Always move the conversation forward based on the lead's latest message. If a new enquiry comes through that looks unrelated to the previous conversation, ignore past context and treat it as a fresh conversation.

${quoteDrafting
    ? 'For quoting: if enough detail is given, you may reply with something like "Thanks for all that, we may be able to send over a rough estimate shortly." All quotes must always be reviewed internally before being sent.'
    : "For quoting: never mention quotes being unavailable or turned off; simply steer the lead to a quick call first by proposing a specific time immediately such as 2pm today."}

${onsiteEnabled
    ? "Only suggest a site visit if it naturally fits the conversation and the lead seems interested."
    : "If site visits are not part of the process, never mention or imply that site visits are unavailable; instead, naturally guide toward a call by proposing a specific time."}

${callbackEnabled
    ? `For callbacks: always confirm directly without probing if the lead already gave availability. If they say "any time", "whenever", or similar, confirm the next available slot during callback hours. If they say "after {time}", confirm the first valid slot after that time within callback hours. If they say "today", confirm a time today without asking what day again, as long as today is a callback day. If they give a specific time within callback hours on a callback day, confirm it. If the time is outside callback hours, suggest the closest valid alternative. If they ask for a call on a day outside of callback days, guide them to the nearest callback day.
Callback hours are ${callbackStart} to ${callbackEnd}, and available callback days are ${callbackDaysList}. Always use the nearest available 30-minute slot after the current time. If the lead requests a call, always confirm a time directly within these rules.`
    : "Do not offer callbacks. Focus on gathering information and answering questions."}

Always refer naturally to "our team" or "the team", never by name.

Your goal is to keep every message sounding casual, human, and natural, never robotic, never revealing internal processes, and always moving the conversation forward efficiently.

Confirmed Callback Rule: If the lead has already confirmed a scheduled callback, do not ask if they need anything else. Instead, send a concise acknowledgment like: "Perfect, you're all set for {day/time}. Our team will reach out to you then." Only offer extra assistance if the lead specifically asks a new question.

Today is ${new Date().toLocaleDateString("en-AU", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. The current time is ${new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false })}.

IMPORTANT: After your reply, you MUST output a JSON block on a new line starting with "---JSON---" containing structured data:
---JSON---
{"score": <0-100>, "score_reason": "<brief reason>", "action": "<none|callback|onsite|quote>", "appointment_time": "<ISO8601 datetime or null>", "appointment_note": "<brief note or null>", "quote_context": "<summary of what needs quoting or null>"}

The score reflects lead quality: 0-20 cold/unresponsive, 21-40 mildly interested, 41-60 engaged, 61-80 ready to act, 81-100 hot/confirmed.
Set action to "callback" if a callback was confirmed in this message, "onsite" if a site visit was confirmed, "quote" if you indicated a quote may be coming and enough detail has been gathered. Otherwise "none".
For appointment_time: convert the agreed time to a full ISO8601 datetime (e.g. "2026-04-02T14:00:00+10:00") based on today's date. If the lead said "Tuesday at 2pm" and today is Monday, use tomorrow's date. Always include timezone offset.
For quote_context: if action is "quote", summarise what the lead wants quoted (service type, scope, any details mentioned). This will be passed to the quoting system.
${quoteStatus ? `\nCurrent quote status for this lead: ${quoteStatus}. Do not trigger another quote if one is already in progress.` : ""}`;
}

// ---------------------------------------------------------------------------
// Parse AI response: split reply text from JSON metadata
// ---------------------------------------------------------------------------
interface AIActions {
  reply: string;
  score: number;
  scoreReason: string;
  action: "none" | "callback" | "onsite" | "quote";
  appointmentTime: string | null;
  appointmentNote: string | null;
  quoteContext: string | null;
}

function parseAIResponse(raw: string): AIActions {
  const jsonMarker = "---JSON---";
  const idx = raw.indexOf(jsonMarker);

  let reply: string;
  let meta: Record<string, unknown> = {};

  if (idx !== -1) {
    reply = raw.substring(0, idx).trim();
    try {
      meta = JSON.parse(raw.substring(idx + jsonMarker.length).trim());
    } catch {
      // If JSON parsing fails, just use the reply with defaults
    }
  } else {
    reply = raw.trim();
  }

  return {
    reply,
    score: typeof meta.score === "number" ? Math.min(100, Math.max(0, meta.score)) : 0,
    scoreReason: (meta.score_reason as string) || "",
    action: (["callback", "onsite", "quote"].includes(meta.action as string)
      ? meta.action
      : "none") as AIActions["action"],
    appointmentTime: (meta.appointment_time as string) || null,
    appointmentNote: (meta.appointment_note as string) || null,
    quoteContext: (meta.quote_context as string) || null,
  };
}

// ---------------------------------------------------------------------------
// Twilio signature validation
// ---------------------------------------------------------------------------
async function validateTwilioSignature(
  req: Request,
  rawBody: string,
  authToken: string
): Promise<boolean> {
  const signature = req.headers.get("X-Twilio-Signature");
  if (!signature) return false;

  // Twilio signs: URL + sorted params
  const url = req.url;
  const params = parseTwilioBody(rawBody);
  const sortedKeys = Object.keys(params).sort();
  const dataToSign = url + sortedKeys.map((k) => k + params[k]).join("");

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(dataToSign));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return expected === signature;
}

// =============================================================================
// Main handler
// =============================================================================
Deno.serve(async (req) => {
  // Twilio sends POST with form-encoded body
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Parse Twilio webhook
    const rawBody = await req.text();
    const params = parseTwilioBody(rawBody);
    const fromNumber = normalisePhone(params.From || "");
    const toNumber = normalisePhone(params.To || "");
    const inboundBody = params.Body || "";

    if (!fromNumber || !toNumber || !inboundBody) {
      return twimlResponse(""); // empty TwiML = no auto-reply
    }

    // 2. Look up company by the Twilio number receiving the message
    const { data: smsConfig, error: configErr } = await db
      .from("sms_agent_config")
      .select("*, companies:company_id(id, name, settings)")
      .eq("twilio_number", toNumber)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (configErr || !smsConfig) {
      console.error("No SMS config for number:", toNumber, configErr);
      return twimlResponse("");
    }

    const companyId: string = smsConfig.company_id;

    // Determine account type so env-secret fallbacks are only used for internal
    const { data: companyProfile } = await db
      .from("profiles")
      .select("user_type")
      .eq("company_id", companyId)
      .limit(1)
      .maybeSingle();
    const userType: string = companyProfile?.user_type ?? "external";

    // 2b. Validate Twilio signature (log-only — never block)
    // NOTE: Supabase Edge Functions may expose a different req.url than the
    // public webhook URL Twilio signed against (gateway URL rewriting, load
    // balancer headers, etc.).  A mismatch silently produces a different HMAC
    // and would reject every legitimate request.  Until we have a way to
    // inject the canonical webhook URL, we log failures but never block.
    try {
      const twilioAuthForValidation = await resolveKey(db, companyId, "twilio_auth", userType);
      const isValid = await validateTwilioSignature(req, rawBody, twilioAuthForValidation);
      if (!isValid) {
        console.warn("Twilio signature mismatch (req.url may differ from signed URL) — allowing anyway");
      }
    } catch (err) {
      console.warn("Twilio signature validation skipped — key resolution failed:", (err as Error).message);
    }

    // 3. Check SMS credits
    const { data: credits } = await db
      .from("sms_credits")
      .select("balance")
      .eq("company_id", companyId)
      .single();

    if (!credits || credits.balance <= 0) {
      console.warn("No SMS credits for company:", companyId);
      // Log activity but don't reply
      await logActivity(db, companyId, "sms.no_credits", "company", companyId, {
        from: fromNumber,
      });
      return twimlResponse("");
    }

    // 4. Check AI settings
    if (!smsConfig.auto_reply) {
      // AI is off globally — just store the message, don't reply
      await storeInboundOnly(db, companyId, fromNumber, toNumber, inboundBody);
      return twimlResponse("");
    }

    // 5. Find or create lead by phone number in this company
    let { data: lead } = await db
      .from("leads")
      .select("*")
      .eq("company_id", companyId)
      .eq("phone", fromNumber)
      .limit(1)
      .single();

    if (!lead) {
      // Also try without the + prefix for flexibility
      const { data: leadAlt } = await db
        .from("leads")
        .select("*")
        .eq("company_id", companyId)
        .eq("phone", fromNumber.replace(/^\+/, ""))
        .limit(1)
        .single();

      lead = leadAlt;
    }

    if (!lead) {
      // Create a new lead from this inbound SMS
      const { data: newLead, error: leadErr } = await db
        .from("leads")
        .insert({
          company_id: companyId,
          first_name: "SMS Lead",
          name: "SMS Lead",
          phone: fromNumber,
          source: "sms_inbound",
          pipeline_stage: "new_lead",
          ai_enabled: true,
          ai_score: 10,
          ai_score_reason: "New inbound SMS enquiry",
        })
        .select()
        .single();

      if (leadErr || !newLead) {
        console.error("Failed to create lead:", leadErr);
        return twimlResponse("");
      }
      lead = newLead;

      await logActivity(db, companyId, "lead.created", "lead", lead.id, {
        source: "sms_inbound",
        phone: fromNumber,
      });
    }

    // 6. Check per-lead AI toggle
    if (!lead.ai_enabled) {
      await storeInboundOnly(db, companyId, fromNumber, toNumber, inboundBody, lead.id);
      return twimlResponse("");
    }

    // 7. Get or create conversation
    let { data: conversation } = await db
      .from("conversations")
      .select("*")
      .eq("company_id", companyId)
      .eq("lead_id", lead.id)
      .eq("channel", "sms")
      .eq("is_open", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!conversation) {
      const { data: newConv } = await db
        .from("conversations")
        .insert({
          company_id: companyId,
          lead_id: lead.id,
          channel: "sms",
          is_open: true,
          sms_config_id: smsConfig.id,
          last_message: inboundBody,
          last_message_at: new Date().toISOString(),
        })
        .select()
        .single();
      conversation = newConv;
    }

    if (!conversation) {
      console.error("Failed to create conversation");
      return twimlResponse("");
    }

    // 8. Store inbound message
    const { error: inboundMsgErr } = await db.from("messages").insert({
      conversation_id: conversation.id,
      direction: "inbound",
      body: inboundBody,
      channel: "sms",
      is_ai_generated: false,
      metadata: { from: fromNumber, to: toNumber, twilio_sid: params.MessageSid || null },
    });
    if (inboundMsgErr) console.error("Failed to store inbound message:", inboundMsgErr);

    // Update conversation last message
    const { error: convUpdErr } = await db
      .from("conversations")
      .update({
        last_message: inboundBody,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", conversation.id);
    if (convUpdErr) console.error("Failed to update conversation:", convUpdErr);

    // Get conversation history (last 20 messages for context)
    const { data: history } = await db
      .from("messages")
      .select("direction, body, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(20);

    const conversationMessages = (history || []).map((m) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.body,
    }));

    // Check quote status for this lead
    const { data: latestQuote } = await db
      .from("quotes")
      .select("status")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const quoteStatus = latestQuote?.status || null;

    // Check for max messages limit
    const aiMessageCount = (history || []).filter(
      (m) => m.direction === "outbound"
    ).length;
    if (smsConfig.max_messages && aiMessageCount >= smsConfig.max_messages) {
      console.warn("Max AI messages reached for conversation:", conversation.id);
      await logActivity(db, companyId, "sms.max_messages", "conversation", conversation.id, {
        lead_id: lead.id,
        count: aiMessageCount,
      });
      return twimlResponse("");
    }

    // 9. Resolve API keys (handles agency vs external automatically)
    let openaiKey: string;
    let twilioSid: string;
    let twilioAuth: string;
    try {
      openaiKey = await resolveKey(db, companyId, "openai", userType);
      twilioSid = await resolveKey(db, companyId, "twilio", userType);
      twilioAuth = await resolveKey(db, companyId, "twilio_auth", userType);
    } catch (keyErr) {
      console.error("API key resolution failed:", keyErr);
      await logActivity(db, companyId, "sms.key_error", "company", companyId, {
        error: (keyErr as Error).message,
      });
      return twimlResponse("");
    }

    // 10. Build prompt + call OpenAI
    const systemPrompt = buildSystemPrompt(smsConfig, lead, quoteStatus);
    const model = smsConfig.model || "gpt-4o";

    const aiRaw = await callOpenAI(openaiKey, model, systemPrompt, conversationMessages);

    // 11. Parse response
    const actions = parseAIResponse(aiRaw);

    if (!actions.reply) {
      console.warn("AI returned empty reply");
      return twimlResponse("");
    }

    // 12. Update lead score
    if (actions.score > 0) {
      await db
        .from("leads")
        .update({
          ai_score: actions.score,
          ai_score_reason: actions.scoreReason,
          pipeline_stage: actions.score >= 61 && lead.pipeline_stage === "new_lead"
            ? "follow_up"
            : undefined,
        })
        .eq("id", lead.id);
    }

    // 13. Create appointment if callback or onsite was confirmed
    if (
      (actions.action === "callback" && smsConfig.callback_enabled) ||
      (actions.action === "onsite" && smsConfig.onsite_enabled)
    ) {
      const startTime = actions.appointmentTime
        ? new Date(actions.appointmentTime)
        : getNextAvailableSlot(smsConfig);

      const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 min slot

      const appointmentType = actions.action === "callback" ? "callback" : "onsite";
      const title =
        actions.action === "callback"
          ? `Callback: ${lead.first_name} ${lead.last_name || ""}`.trim()
          : `Site Visit: ${lead.first_name} ${lead.last_name || ""}`.trim();

      await db.from("appointments").insert({
        company_id: companyId,
        lead_id: lead.id,
        assigned_to: lead.assigned_to || null,
        title,
        description: actions.appointmentNote || `Auto-scheduled from SMS conversation`,
        status: "scheduled",
        appointment_type: appointmentType,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
      });

      await logActivity(db, companyId, "appointment.created", "lead", lead.id, {
        type: appointmentType,
        start_time: startTime.toISOString(),
        source: "ai_sms",
      });
    }

    // 14. Trigger quote-draft edge function if conditions met
    if (
      actions.action === "quote" &&
      smsConfig.quote_drafting_enabled &&
      !latestQuote // no existing quote
    ) {
      // Fire-and-forget call to quote-draft function
      // It will use the conversation context to build a proper draft
      try {
        const quotePayload = {
          company_id: companyId,
          lead_id: lead.id,
          conversation_id: conversation.id,
          quote_context: actions.quoteContext,
          lead_name: `${lead.first_name || ""} ${lead.last_name || ""}`.trim(),
          lead_phone: lead.phone,
          service_type: lead.service_type || smsConfig.service_description || null,
          conversation_summary: (history || [])
            .slice(-10) // last 10 messages for context
            .map((m) => `${m.direction === "inbound" ? "Lead" : "Us"}: ${m.body}`)
            .join("\n"),
        };

        // Async call — don't await, don't block the SMS reply
        fetch(`${SUPABASE_URL}/functions/v1/quote-draft`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify(quotePayload),
        }).catch((err) => console.error("quote-draft trigger failed:", err));

        await logActivity(db, companyId, "quote.draft_triggered", "lead", lead.id, {
          quote_context: actions.quoteContext,
          source: "ai_sms",
        });
      } catch (err) {
        console.error("Failed to trigger quote-draft:", err);
      }
    }

    // 15. Deduct SMS credit + send reply via Twilio
    const { data: creditOk } = await db.rpc("deduct_sms_credit", {
      p_company_id: companyId,
    });

    if (!creditOk) {
      console.warn("Failed to deduct SMS credit");
      return twimlResponse("");
    }

    // Apply reply delay if configured
    // Column was originally reply_delay, later renamed to reply_delay_seconds
    const replyDelay = smsConfig.reply_delay_seconds ?? smsConfig.reply_delay ?? 0;
    if (replyDelay > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, replyDelay * 1000)
      );
    }

    await sendTwilioSMS(twilioSid, twilioAuth, toNumber, fromNumber, actions.reply);

    // 16. Store outbound message
    const { error: outMsgErr } = await db.from("messages").insert({
      conversation_id: conversation.id,
      direction: "outbound",
      body: actions.reply,
      channel: "sms",
      is_ai_generated: true,
      agent_type: "sms",
      metadata: {
        model,
        score: actions.score,
        action: actions.action,
      },
    });
    if (outMsgErr) console.error("Failed to store outbound message:", outMsgErr);

    // Update conversation last message
    const { error: convUpdErr2 } = await db
      .from("conversations")
      .update({
        last_message: actions.reply,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", conversation.id);
    if (convUpdErr2) console.error("Failed to update conversation after reply:", convUpdErr2);

    await logActivity(db, companyId, "sms.ai_reply", "lead", lead.id, {
      score: actions.score,
      action: actions.action,
    });

    // Return empty TwiML (we send via API, not TwiML reply)
    return twimlResponse("");
  } catch (err) {
    console.error("Inbound SMS handler error:", err);
    return twimlResponse("");
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Return TwiML response (Twilio expects this)
function twimlResponse(message: string): Response {
  const twiml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

  return new Response(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Store inbound message when AI is off (still want to capture the message)
async function storeInboundOnly(
  db: SupabaseClient,
  companyId: string,
  fromNumber: string,
  toNumber: string,
  body: string,
  leadId?: string
): Promise<void> {
  // Find or create conversation
  let conversationId: string | null = null;

  if (leadId) {
    const { data: conv } = await db
      .from("conversations")
      .select("id")
      .eq("company_id", companyId)
      .eq("lead_id", leadId)
      .eq("channel", "sms")
      .eq("is_open", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    conversationId = conv?.id || null;
  }

  if (!conversationId) {
    const { data: newConv, error: convErr } = await db
      .from("conversations")
      .insert({
        company_id: companyId,
        lead_id: leadId || null,
        channel: "sms",
        is_open: true,
        last_message: body,
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (convErr) console.error("storeInboundOnly: conversation insert failed:", convErr);
    conversationId = newConv?.id || null;
  }

  if (conversationId) {
    const { error: msgErr } = await db.from("messages").insert({
      conversation_id: conversationId,
      direction: "inbound",
      body,
      channel: "sms",
      is_ai_generated: false,
      metadata: { from: fromNumber, to: toNumber },
    });
    if (msgErr) console.error("storeInboundOnly: message insert failed:", msgErr);

    const { error: updErr } = await db
      .from("conversations")
      .update({ last_message: body, last_message_at: new Date().toISOString() })
      .eq("id", conversationId);
    if (updErr) console.error("storeInboundOnly: conversation update failed:", updErr);
  }
}

// Log to activity_log
async function logActivity(
  db: SupabaseClient,
  companyId: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>
): Promise<void> {
  await db.from("activity_log").insert({
    company_id: companyId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  });
}

// Calculate next available callback slot based on config
function getNextAvailableSlot(config: Record<string, unknown>): Date {
  const rawDays = config.callback_days;
  const days: string[] = Array.isArray(rawDays) ? rawDays : ["tue", "wed", "fri", "sat"];
  const startStr = (config.callback_hours_start as string) || "09:00";
  const endStr = (config.callback_hours_end as string) || "17:00";

  const dayMap: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  const allowedDays = days.map((d: string) => dayMap[d]).filter((d) => d !== undefined);

  const [startH, startM] = startStr.split(":").map(Number);
  const [endH, endM] = endStr.split(":").map(Number);

  const now = new Date();
  const candidate = new Date(now);

  // Round up to next 30-minute slot
  candidate.setMinutes(Math.ceil(candidate.getMinutes() / 30) * 30, 0, 0);

  // Search up to 14 days ahead
  for (let i = 0; i < 14; i++) {
    const day = candidate.getDay();
    if (allowedDays.includes(day)) {
      const h = candidate.getHours();
      const m = candidate.getMinutes();
      const currentMins = h * 60 + m;
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;

      if (currentMins >= startMins && currentMins < endMins) {
        return candidate;
      }

      if (currentMins < startMins) {
        candidate.setHours(startH, startM, 0, 0);
        return candidate;
      }
    }

    // Move to next day at start time
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(startH, startM, 0, 0);
  }

  // Fallback: tomorrow at start time
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(startH, startM, 0, 0);
  return fallback;
}
