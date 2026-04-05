import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Fire-and-forget call to ai-learner for knowledge extraction ──────────────
function triggerAILearner(
  event: string,
  companyId: string,
  leadId: string,
  metadata?: Record<string, unknown>,
): void {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  fetch(`${supabaseUrl}/functions/v1/ai-learner`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      event,
      company_id: companyId,
      lead_id: leadId,
      metadata,
    }),
  }).catch((err) => console.error("ai-learner trigger failed:", err));
}

// ── Outbound webhook helper ───────────────────────────────────────────────────
async function fireWebhooks(
  adminClient: ReturnType<typeof createClient>,
  companyId: string,
  event: string,
  payload: unknown,
) {
  try {
    const { data: endpoints } = await adminClient
      .from("webhook_endpoints")
      .select("id, url, secret, events")
      .eq("company_id", companyId)
      .eq("active", true);
    if (!endpoints || endpoints.length === 0) return;
    for (const ep of endpoints) {
      const events = Array.isArray(ep.events) ? ep.events : [];
      if (!events.includes(event)) continue;
      if (!ep.secret) { console.warn("fireWebhooks: skipping endpoint with no secret", ep.id); continue; }
      const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", encoder.encode(ep.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
      const signature = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
      (async () => {
        let success = false, responseStatus = 0, responseBody = "";
        try {
          const res = await fetch(ep.url, { method: "POST", headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature, "X-Webhook-Event": event }, body });
          responseStatus = res.status; responseBody = (await res.text()).slice(0, 1000); success = res.ok;
        } catch (err) { responseBody = `${(err as Error).name}: ${(err as Error).message}`; }
        await adminClient.from("webhook_deliveries").insert({ webhook_id: ep.id, company_id: companyId, event, payload: JSON.parse(body), response_status: responseStatus, response_body: responseBody, success });
      })();
    }
  } catch (err) { console.error("fireWebhooks error:", err); }
}

/**
 * VAPI Webhook — Edge Function
 *
 * Receives server events from VAPI and updates voice_calls records accordingly.
 *
 * Security: Verified via x-vapi-secret header. The VAPI_WEBHOOK_SECRET env var
 * must match the serverUrlSecret provided at call creation time. VAPI sends
 * this secret as the x-vapi-secret header on every webhook request.
 *
 * Handled event types:
 *   - status-update:        Updates call status (ringing → in_progress, etc.)
 *   - end-of-call-report:   Updates transcript, summary, recording, duration, etc.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Verify VAPI webhook secret ──────────────────────────────────────────
  const webhookSecret = Deno.env.get("VAPI_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("VAPI webhook: VAPI_WEBHOOK_SECRET is not configured — rejecting request");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const incomingSecret = req.headers.get("x-vapi-secret");
  if (incomingSecret !== webhookSecret) {
    console.warn("VAPI webhook: invalid or missing x-vapi-secret header");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const message = body?.message;

    if (!message || !message.type) {
      // VAPI may send a ping / health-check with no message — acknowledge it.
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const vapiCallId = message.call?.id;
    if (!vapiCallId) {
      console.warn("VAPI webhook: no call.id in message, type:", message.type);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── status-update ──────────────────────────────────────────────────────
    if (message.type === "status-update") {
      const vapiStatus: string = message.status;

      // Map VAPI statuses to our call_status enum
      const statusMap: Record<string, string> = {
        ringing: "ringing",
        "in-progress": "in_progress",
        forwarding: "in_progress",
        ended: "completed",
      };

      const mappedStatus = statusMap[vapiStatus];
      if (mappedStatus) {
        const updatePayload: Record<string, unknown> = {
          status: mappedStatus,
        };

        // Record when the call actually starts
        if (mappedStatus === "in_progress") {
          updatePayload.started_at = new Date().toISOString();
        }

        const { error } = await adminClient
          .from("voice_calls")
          .update(updatePayload)
          .eq("vapi_call_id", vapiCallId);

        if (error) {
          console.error("Failed to update call status:", error.message);
        } else {
          console.log(`Call ${vapiCallId} status → ${mappedStatus}`);
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── end-of-call-report ─────────────────────────────────────────────────
    if (message.type === "end-of-call-report") {
      const updatePayload: Record<string, unknown> = {
        status: "completed",
        ended_at: message.call?.endedAt || message.endedAt || new Date().toISOString(),
      };

      // Transcript — plain text string
      if (message.transcript) {
        updatePayload.transcript = message.transcript;
      }

      // AI-generated summary
      if (message.summary) {
        updatePayload.summary = message.summary;
      }

      // Recording URL
      if (message.recordingUrl) {
        updatePayload.recording_url = message.recordingUrl;
      }

      // Duration — VAPI may send message.call.duration directly, or we
      // compute it from startedAt / endedAt timestamps on the call object.
      if (message.call?.duration != null) {
        updatePayload.duration = Math.round(message.call.duration);
      } else {
        const s = message.call?.startedAt || message.startedAt;
        const e = message.call?.endedAt || message.endedAt;
        if (s && e) {
          const started = new Date(s).getTime();
          const ended = new Date(e).getTime();
          if (!isNaN(started) && !isNaN(ended) && ended > started) {
            updatePayload.duration = Math.round((ended - started) / 1000);
          }
        }
      }

      // Cost
      if (message.call?.cost != null) {
        updatePayload.cost = message.call.cost;
      }

      // Analysis fields (sentiment, outcome, etc.)
      if (message.analysis) {
        if (message.analysis.sentiment) {
          updatePayload.sentiment = message.analysis.sentiment;
        }
        if (message.analysis.callReason) {
          updatePayload.outcome = message.analysis.callReason;
        }
      }

      // Determine final status based on endedReason
      const endedReason: string = message.endedReason || "";
      if (
        endedReason === "customer-did-not-answer" ||
        endedReason === "customer-busy"
      ) {
        updatePayload.status = "missed";
      } else if (
        endedReason === "voicemail" ||
        endedReason === "customer-did-not-give-microphone-permission"
      ) {
        updatePayload.status = "voicemail";
      } else if (
        endedReason === "error" ||
        endedReason === "pipeline-error-openai-llm-failed" ||
        endedReason.startsWith("pipeline-error") ||
        endedReason === "twilio-failed-to-connect-call"
      ) {
        updatePayload.status = "failed";
      }
      // Otherwise stays "completed"

      // Store full messages array and endedReason in metadata for debugging
      const meta: Record<string, unknown> = {};
      if (message.messages) {
        meta.messages = message.messages;
      }
      if (endedReason) {
        meta.endedReason = endedReason;
      }
      if (Object.keys(meta).length > 0) {
        updatePayload.metadata = meta;
      }

      const { error } = await adminClient
        .from("voice_calls")
        .update(updatePayload)
        .eq("vapi_call_id", vapiCallId);

      if (error) {
        console.error("Failed to update end-of-call report:", error.message);
      } else {
        console.log(
          `Call ${vapiCallId} end-of-call-report processed (status: ${updatePayload.status})`,
        );

        // Fire webhook for call completion
        if (updatePayload.status === "completed") {
          const { data: callForWh } = await adminClient.from("voice_calls").select("company_id, lead_id").eq("vapi_call_id", vapiCallId).single();
          if (callForWh) {
            fireWebhooks(adminClient, callForWh.company_id, "call.completed", { vapi_call_id: vapiCallId, lead_id: callForWh.lead_id, status: "completed" });
          }
        }

        // ── Post-call AI analysis: summary, score, appointment detection ──
        // Only run for completed calls with a transcript
        if (
          updatePayload.status === "completed" &&
          message.transcript
        ) {
          try {
            // 1. Fetch the voice_call to get lead_id and company_id
            const { data: callRecord } = await adminClient
              .from("voice_calls")
              .select("lead_id, company_id")
              .eq("vapi_call_id", vapiCallId)
              .single();

            if (callRecord?.lead_id && callRecord?.company_id) {
              // 2. Resolve OpenAI API key
              let openaiKey: string | null = null;
              const { data: resolvedKey } = await adminClient.rpc(
                "resolve_api_key",
                {
                  p_company_id: callRecord.company_id,
                  p_provider: "openai",
                },
              );
              if (resolvedKey) {
                openaiKey = resolvedKey as string;
              } else {
                // Fall back to platform env secret
                const envKey = Deno.env.get("OPEN_AI_API_KEY");
                if (envKey) openaiKey = envKey;
              }

              if (openaiKey) {
                const transcript = message.transcript as string;
                const todayStr = new Date().toISOString().split("T")[0];
                const analysisPrompt = `You are analysing a voice call transcript for a business CRM. Produce a JSON object with exactly these keys:
- "summary": a concise 2-3 sentence summary of the call including what was discussed, any commitments made, and the outcome.
- "score": an integer 0-100 reflecting lead quality / likelihood to convert based on the conversation.
- "status": one of "hot", "warm", "cold" based on the score (>=75 hot, >=40 warm, else cold).
- "appointment_detected": boolean — true ONLY if a specific appointment date/time AND type (callback, onsite visit, site inspection, meeting, etc.) were clearly agreed upon in the conversation.
- "appointment_time": ISO 8601 datetime string of the agreed appointment, or null if none detected. If no year is stated, assume the nearest future occurrence of the given date relative to today (${todayStr}).
- "appointment_type": one of "callback", "onsite", or "other" — or null if no appointment detected. Use "callback" for phone callbacks, "onsite" for site visits/inspections/meetings at a location.
- "appointment_note": a brief description of the appointment purpose, or null.

IMPORTANT: Only set appointment_detected to true if BOTH a specific time/date AND a type of appointment are clearly identifiable in the conversation. Do not guess or infer appointments that were not explicitly agreed upon.

Today's date: ${todayStr}

Transcript:
${transcript}

Respond ONLY with the JSON object, no markdown fences.`;

                const aiRes = await fetch(
                  "https://api.openai.com/v1/chat/completions",
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${openaiKey}`,
                    },
                    body: JSON.stringify({
                      model: "gpt-4o",
                      messages: [
                        { role: "user", content: analysisPrompt },
                      ],
                      temperature: 0.3,
                      max_tokens: 400,
                    }),
                  },
                );

                if (aiRes.ok) {
                  const aiJson = await aiRes.json();
                  const rawContent =
                    aiJson.choices?.[0]?.message?.content?.trim() ?? "";
                  try {
                    const parsed = JSON.parse(rawContent);

                    // Derive status from score if not provided
                    const aiStatus =
                      parsed.status === "hot" ||
                      parsed.status === "warm" ||
                      parsed.status === "cold"
                        ? parsed.status
                        : parsed.score >= 75
                          ? "hot"
                          : parsed.score >= 40
                            ? "warm"
                            : "cold";

                    // Update lead with AI summary, score, and status
                    const leadUpdate: Record<string, unknown> = {
                      ai_summary: parsed.summary || null,
                      ai_status: aiStatus,
                    };
                    if (
                      typeof parsed.score === "number" &&
                      parsed.score >= 0 &&
                      parsed.score <= 100
                    ) {
                      leadUpdate.ai_score = parsed.score;
                      leadUpdate.ai_score_reason = "Updated from AI voice call analysis";
                    }

                    await adminClient
                      .from("leads")
                      .update(leadUpdate)
                      .eq("id", callRecord.lead_id);

                    console.log(
                      `Lead ${callRecord.lead_id} AI summary updated from voice call`,
                    );

                    // Auto-create appointment if time + type detected
                    if (
                      parsed.appointment_detected === true &&
                      parsed.appointment_time &&
                      parsed.appointment_type
                    ) {
                      const apptTime = new Date(parsed.appointment_time);
                      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
                      // Validate the parsed time is a valid future-ish date
                      if (
                        !isNaN(apptTime.getTime()) &&
                        apptTime.getTime() > Date.now() - ONE_DAY_MS // allow up to 1 day in past for timezone tolerance
                      ) {
                        const apptType =
                          parsed.appointment_type === "callback" ||
                          parsed.appointment_type === "onsite"
                            ? parsed.appointment_type
                            : "other";

                        // Fetch lead name for the appointment title
                        const { data: leadData } = await adminClient
                          .from("leads")
                          .select("name, assigned_to, pipeline_stage")
                          .eq("id", callRecord.lead_id)
                          .single();

                        const leadName = leadData?.name || "Voice Lead";
                        const titlePrefix =
                          apptType === "callback"
                            ? "Callback"
                            : apptType === "onsite"
                              ? "Site Visit"
                              : "Appointment";

                        const DEFAULT_APPT_DURATION_MS = 30 * 60 * 1000;
                        const endTime = new Date(
                          apptTime.getTime() + DEFAULT_APPT_DURATION_MS,
                        );

                        await adminClient.from("appointments").insert({
                          company_id: callRecord.company_id,
                          lead_id: callRecord.lead_id,
                          assigned_to: leadData?.assigned_to || null,
                          title: `${titlePrefix}: ${leadName}`,
                          description:
                            parsed.appointment_note ||
                            "Auto-scheduled from AI voice call",
                          status: "scheduled",
                          appointment_type: apptType,
                          start_time: apptTime.toISOString(),
                          end_time: endTime.toISOString(),
                          booked_by: "ai",
                        });

                        // Advance pipeline if still at new_lead
                        if (leadData?.pipeline_stage === "new_lead") {
                          await adminClient
                            .from("leads")
                            .update({ pipeline_stage: "follow_up" })
                            .eq("id", callRecord.lead_id);
                        }

                        fireWebhooks(adminClient, callRecord.company_id, "appointment.booked", { lead_id: callRecord.lead_id, lead_name: leadName, appointment_type: apptType, start_time: apptTime.toISOString(), source: "ai_voice" });

                        // Create notification
                        const scheduledStr = apptTime.toLocaleString("en-AU", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        });
                        await adminClient
                          .from("notifications")
                          .insert({
                            company_id: callRecord.company_id,
                            lead_id: callRecord.lead_id,
                            type:
                              apptType === "callback"
                                ? "callback_booked"
                                : "onsite_booked",
                            title: `AI booked ${apptType === "callback" ? "a callback" : apptType === "onsite" ? "an on-site visit" : "an appointment"} with ${leadName}`,
                            message: `Scheduled for ${scheduledStr} (detected from voice call)`,
                            metadata: {
                              appointment_type: apptType,
                              start_time: apptTime.toISOString(),
                              source: "ai_voice",
                            },
                          })
                          .catch((notifErr: unknown) =>
                            console.error(
                              "Failed to create voice appointment notification:",
                              notifErr,
                            ),
                          );

                        console.log(
                          `Auto-created ${apptType} appointment for lead ${callRecord.lead_id} from voice call transcript`,
                        );

                        // Trigger AI learner for appointment booking insights
                        triggerAILearner("appointment.booked", callRecord.company_id, callRecord.lead_id, {
                          appointment_type: apptType,
                          source: "ai_voice",
                        });
                      } else {
                        console.warn(
                          `Appointment time detected but invalid or too far in past: ${parsed.appointment_time}`,
                        );
                      }
                    }
                  } catch (parseErr) {
                    console.error(
                      "Failed to parse AI analysis response:",
                      parseErr,
                    );
                  }
                } else {
                  console.error(
                    "OpenAI call failed for voice analysis:",
                    aiRes.status,
                  );
                }
              } else {
                console.warn(
                  "No OpenAI key available for voice call analysis",
                );
              }
            }
          } catch (analysisErr) {
            // Non-blocking: don't fail the webhook if analysis fails
            console.error("Post-call AI analysis error:", analysisErr);
          }
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Unhandled event type — acknowledge to prevent retries ───────────────
    console.log("VAPI webhook: unhandled event type:", message.type);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("vapi-webhook error:", err);
    // Always return 200 to VAPI to prevent infinite retries
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
