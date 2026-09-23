// twilio-team-sms — a client texts their account manager back.
//
// This answers the TEAM's number only. It is deliberately not part of
// twilio-inbound-sms, which answers the AI's number, matches a sender against
// each company's LEADS and hands the message to an AI that talks to prospects.
// A client texting their account manager is none of those things, and two
// client numbers also exist in `leads`, so sharing one webhook would mean one
// branch standing between a paying client and an AI pitching solar at them.
//
// Nothing here replies. It stores the message and gets out of the way; a person
// answers from the Team Panel.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Twilio retries on a non-2xx, so anything not worth retrying answers 200 with
// empty TwiML - which also means the sender gets no auto-reply.
const noReply = () =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });

// Same conservative rules as the dialling path: convert only what cannot mean
// anything else, and never guess a country.
function toE164(raw: unknown): string | null {
  let p = String(raw ?? "").replace(/[\s\-().]/g, "");
  if (!p) return null;
  if (p.startsWith("+")) {
    // already international
  } else if (p.startsWith("0011")) {
    p = "+" + p.slice(4);
  } else if (p.startsWith("00")) {
    p = "+" + p.slice(2);
  } else if (/^0\d{9}$/.test(p)) {
    p = "+61" + p.slice(1);
  } else if (/^1(300|800)\d{6}$/.test(p) || /^13\d{4}$/.test(p)) {
    p = "+61" + p;
  } else if (/^61\d{9}$/.test(p)) {
    p = "+" + p;
  }
  if (!p.startsWith("+")) return null;
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return noReply();

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await req.text());
  } catch {
    return noReply();
  }

  const fromRaw = form.get("From") ?? "";
  const toRaw = form.get("To") ?? "";
  const body = form.get("Body") ?? "";
  const sid = form.get("MessageSid") ?? form.get("SmsSid") ?? null;
  if (!fromRaw || !toRaw) return noReply();

  const from = toE164(fromRaw) ?? fromRaw;
  const to = toE164(toRaw) ?? toRaw;

  // Refuse anything not addressed to the team's own number. Without this, a
  // misconfigured webhook on the AI's number would quietly start filing leads'
  // replies into the team inbox, where nobody is expecting a stranger.
  const { data: ps } = await db
    .from("platform_settings").select("team_sms_number").eq("id", 1).maybeSingle();
  const teamNumber = toE164(ps?.team_sms_number);
  if (!teamNumber || to !== teamNumber) {
    console.warn("twilio-team-sms: message for", to, "is not the team number", teamNumber);
    return noReply();
  }

  // Who is this? Matched against the client book - the company's own number
  // first, then any contact on it.
  let companyId: string | null = null;
  let contactId: string | null = null;

  const { data: byCompany } = await db
    .from("companies").select("id").eq("phone", from).limit(1);
  if (byCompany?.length) {
    companyId = byCompany[0].id as string;
  } else {
    const { data: byContact } = await db
      .from("profiles").select("id, company_id").eq("phone", from)
      .not("company_id", "is", null).limit(1);
    if (byContact?.length) {
      companyId = byContact[0].company_id as string;
      contactId = byContact[0].id as string;
    }
  }

  // An unrecognised number is STORED, not dropped, with company_id null. The
  // last time an inbound message had nowhere to go it was silently discarded and
  // the threads showed "Unknown" for months. A real enquiry from a number nobody
  // has saved yet should read as a phone number somebody can ring back.
  const { error } = await db.from("team_sms_message").insert({
    company_id: companyId,
    contact_id: contactId,
    direction: "inbound",
    from_number: from,
    to_number: to,
    body: body.slice(0, 4000),
    twilio_sid: sid,
    status: "received",
  });
  // A duplicate delivery of the same MessageSid hits the unique index. That is
  // Twilio retrying, not an error, and must not make it retry again.
  if (error && !String(error.message).includes("duplicate")) {
    console.error("twilio-team-sms: insert failed:", error.message);
  }

  return noReply();
});
