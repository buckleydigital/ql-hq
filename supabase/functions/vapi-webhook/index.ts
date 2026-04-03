import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * VAPI Webhook — Edge Function
 *
 * Receives server events from VAPI and updates voice_calls records accordingly.
 *
 * Security: No JWT verification — VAPI sends events to the serverUrl we provide
 * at call creation time. The URL is not publicly discoverable and all updates
 * are scoped to existing vapi_call_id records. VAPI also supports server
 * authentication via credentialId if additional security is needed later.
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
      } else if (message.call?.startedAt && message.call?.endedAt) {
        const started = new Date(message.call.startedAt).getTime();
        const ended = new Date(message.call.endedAt).getTime();
        if (!isNaN(started) && !isNaN(ended) && ended > started) {
          updatePayload.duration = Math.round((ended - started) / 1000);
        }
      } else if (message.startedAt && message.endedAt) {
        const started = new Date(message.startedAt).getTime();
        const ended = new Date(message.endedAt).getTime();
        if (!isNaN(started) && !isNaN(ended) && ended > started) {
          updatePayload.duration = Math.round((ended - started) / 1000);
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
