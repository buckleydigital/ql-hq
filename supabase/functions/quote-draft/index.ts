// =============================================================================
// QuoteLeadsHQ — Quote Draft Generator
// =============================================================================
// Triggered by twilio-inbound-sms when AI detects the lead is ready for a quote.
// Receives conversation context and creates a draft quote with AI-extracted details.
//
// Payload from twilio-inbound-sms:
// {
//   company_id, lead_id, conversation_id,
//   quote_context,          — AI summary of what needs quoting
//   lead_name, lead_phone,
//   service_type,           — from lead or company config
//   conversation_summary    — last 10 messages formatted as text
// }
//
// This function can be expanded to:
//   - Use OpenAI to extract line items from conversation
//   - Look up pricing tables
//   - Generate PDF
//   - Notify the team
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const {
      company_id,
      lead_id,
      conversation_id,
      quote_context,
      lead_name,
      lead_phone,
      service_type,
      conversation_summary,
    } = await req.json();

    if (!company_id || !lead_id) {
      return new Response(JSON.stringify({ error: "company_id and lead_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if a quote already exists for this lead (prevent duplicates)
    const { data: existing } = await db
      .from("quotes")
      .select("id")
      .eq("lead_id", lead_id)
      .limit(1)
      .single();

    if (existing) {
      return new Response(JSON.stringify({ message: "Quote already exists", quote_id: existing.id }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Generate quote number
    const quoteNumber = `Q-${Date.now().toString(36).toUpperCase()}`;

    // Build notes from AI context
    const notes = [
      quote_context ? `AI Context: ${quote_context}` : null,
      service_type ? `Service: ${service_type}` : null,
      lead_name ? `Lead: ${lead_name}` : null,
      lead_phone ? `Phone: ${lead_phone}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    // ─── TODO: Expand this section ────────────────────────────────────
    // You can add OpenAI call here to:
    //   1. Parse conversation_summary into structured line items
    //   2. Look up pricing from a pricing table
    //   3. Calculate subtotal/tax/total
    //   4. Generate a more detailed quote
    //
    // For now, create a draft with the context attached so the team
    // can review and fill in pricing manually.
    // ──────────────────────────────────────────────────────────────────

    const { data: quote, error } = await db
      .from("quotes")
      .insert({
        company_id,
        lead_id,
        quote_number: quoteNumber,
        status: "draft",
        notes,
        line_items: [],
        metadata: {
          source: "ai_sms",
          conversation_id,
          quote_context,
          conversation_summary: conversation_summary?.slice(0, 2000), // cap length
        },
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to create quote:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Log activity
    await db.from("activity_log").insert({
      company_id,
      action: "quote.drafted",
      entity_type: "quote",
      entity_id: quote.id,
      details: {
        quote_number: quoteNumber,
        lead_id,
        quote_context,
        source: "ai_sms",
      },
    });

    console.log(`Quote ${quoteNumber} drafted for lead ${lead_id}`);

    return new Response(JSON.stringify({ success: true, quote }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("quote-draft error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg || "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
