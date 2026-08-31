import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!

// callback-request - the "Request a callback" button on the branded solar lead
// system funnel (ql-site) posts here. It does two things with the enquiry:
//
//   1. puts it on ql-mc's Sales Pipeline board, via the create_pipeline_lead
//      action on ql-mc's existing sync-from-hq bridge (the same
//      QL_MC_API_URL / QL_MC_API_SECRET pair stripe-webhook, dispute-lead and
//      send-sms already use). ql-mc owns the pipeline, so the lead row is
//      created there, not here.
//   2. emails contact@ so someone sees it without opening the board.
//
// Called from the public funnel page, so it answers the CORS preflight itself.
// Posting straight to a third party webhook from the browser does not work:
// the preflight goes unanswered and the request never leaves.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const esc = (v: unknown) =>
  String(v ?? '-').replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string))

// The funnel sends the platform's niche slugs; render them the way the rest of
// the system labels them so this email reads like every other notice.
const NICHE_LABELS: Record<string, string> = {
  solar:            'All Solar',
  solar_battery:    'Solar + Battery',
  battery_retrofit: 'Battery Retrofit',
  commercial_solar: 'Commercial Solar',
}

const nicheLabel = (slug: string) => (slug ? NICHE_LABELS[slug] ?? slug : '-')

// Hand the enquiry to ql-mc so it lands on the Sales Pipeline as a New Lead.
// Best effort: if ql-mc is unreachable the visitor still gets a confirmation
// and contact@ still gets the email, rather than being told it did not send.
async function createPipelineLead(payload: Record<string, unknown>): Promise<boolean> {
  const QL_MC_API_URL    = Deno.env.get('QL_MC_API_URL')
  const QL_MC_API_SECRET = Deno.env.get('QL_MC_API_SECRET')
  if (!QL_MC_API_URL || !QL_MC_API_SECRET) {
    console.warn('QL_MC_API_URL / QL_MC_API_SECRET not configured - callback not added to the ql-mc pipeline')
    return false
  }
  try {
    const res = await fetch(`${QL_MC_API_URL}/sync-from-hq`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-secret': QL_MC_API_SECRET },
      body: JSON.stringify({ action: 'create_pipeline_lead', ...payload }),
    })
    if (!res.ok) {
      console.error('createPipelineLead: ql-mc returned', res.status, await res.text())
      return false
    }
    return true
  } catch (e) {
    console.error('createPipelineLead error:', e instanceof Error ? e.message : e)
    return false
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json()
    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim()
    const phone = String(body.phone ?? '').trim()

    // The page validates before it gets here; this is the backstop.
    if (!name || !email || !phone) {
      return json({ error: 'Name, email and phone are required.' }, 400)
    }

    const company = String(body.company ?? '').trim()
    const postcode = String(body.postcode ?? '').trim()
    const source = String(body.source ?? 'unknown').trim()
    const nicheSlug = String(body.niche ?? '').trim()
    const niche = nicheLabel(nicheSlug)

    // The pipeline card first - it is the half a rep actually works from.
    // ql-mc maps the campaign slug onto its own niche vocabulary.
    const onPipeline = await createPipelineLead({
      name, company, email, phone, postcode, source, campaign: nicheSlug,
    })

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'QuoteLeads System <system@quoteleads.com.au>',
        to: 'contact@quoteleads.com.au',
        reply_to: email,
        subject: `📞 Callback requested - ${company || name}`,
        html: `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#333;line-height:1.7">
          <p><strong>${esc(name)}</strong> asked for a callback. They were told we would ring within the hour.</p>
          <table style="border-collapse:collapse;font-size:14px">
            <tr><td style="padding:3px 14px 3px 0;color:#666">Name</td><td>${esc(name)}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666">Company</td><td>${esc(company)}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666">Email</td><td>${esc(email)}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666">Phone</td><td>${esc(phone)}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666">Service area</td><td>${esc(postcode)}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666">Campaign</td><td>${esc(niche)}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666">Source</td><td>${esc(source)}</td></tr>
          </table>
        </div>`,
      }),
    })

    if (!res.ok) {
      console.error('resend error:', await res.text())
      // Only a failure the visitor should see if nothing at all got through.
      if (!onPipeline) return json({ error: 'Could not send the request.' }, 502)
    }

    return json({ success: true })
  } catch (err) {
    console.error('callback-request error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
