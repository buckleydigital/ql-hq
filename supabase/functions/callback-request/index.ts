import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import '../_shared/no-em-dash.ts'

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

// Every form that posts here shows a Cloudflare Turnstile check; without
// verifying it here a bot could skip the page and post straight to this
// function, filling the Sales Pipeline and contact@ with junk.
//
// The website (quoteleads.com.au) and the dashboard (quoteleadshq.com) use
// DIFFERENT Turnstile site keys, and each key has its own secret:
//   CF_TURNSTILE_SECRET       - dashboard key 0x4AAAAAAC0NesB... (login etc.)
//   CF_TURNSTILE_SECRET_SITE  - website key   0x4AAAAAABj4xs... (these forms)
// A token is accepted if either secret verifies it.
async function verifyWith(secret: string, token: string, ip: string | null): Promise<string[] | true> {
  const form = new URLSearchParams({ secret, response: token })
  if (ip) form.set('remoteip', ip)
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  const data = await res.json()
  return data.success === true ? true : (data['error-codes'] ?? ['unknown'])
}

async function turnstileOk(token: string, ip: string | null): Promise<boolean> {
  if (!token) return false
  const secrets = [Deno.env.get('CF_TURNSTILE_SECRET_SITE'), Deno.env.get('CF_TURNSTILE_SECRET')]
    .filter((v): v is string => !!v)
  if (!secrets.length) {
    console.error('No Turnstile secret is set')
    return false
  }
  const errors: string[] = []
  for (const secret of secrets) {
    try {
      const r = await verifyWith(secret, token, ip)
      if (r === true) return true
      errors.push(...r)
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  console.warn('turnstile siteverify said no:', errors.join(', '))
  return false
}

// What each page told the visitor about when we would call. The solar funnel
// promises within the hour; the get-started style forms say business hours.
const promisedCall = (source: string) =>
  /branded-solar/i.test(source) ? 'within the hour' : 'during business hours (AEST)'

// A short thank-you to the person who enquired. Best effort: a failure here
// never affects their enquiry.
async function sendWelcomeEmail(to: string, name: string) {
  const first = name.split(/\s+/)[0] || 'there'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'QuoteLeads <onboarding@quoteleads.com.au>',
      to,
      reply_to: 'contact@quoteleads.com.au',
      subject: `Thanks ${first}, we'll call you shortly`,
      html: `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f5f5f5;margin:0;padding:40px 20px">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5">
          <div style="background:#0a0b0f;padding:28px 36px">
            <img src="https://quoteleads.com.au/quoteleads-logo-white.png" alt="QuoteLeads" style="height:30px">
          </div>
          <div style="padding:36px">
            <h1 style="font-size:22px;font-weight:600;color:#0a0b0f;margin:0 0 12px">Thanks ${esc(first)}.</h1>
            <p style="color:#555;font-size:15px;line-height:1.6;margin:0">
              We've received your request. You can expect a call from our team shortly, during business hours (AEST).
            </p>
            <p style="font-size:12px;color:#999;margin:28px 0 0;line-height:1.6">
              QuoteLeads &middot; <a href="https://quoteleads.com.au" style="color:#999">quoteleads.com.au</a>
            </p>
          </div>
        </div>
      </body></html>`,
    }),
  })
  if (!res.ok) console.error('welcome email failed:', res.status, await res.text())
}

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

    // Enforced since 2026-10-08, after a real website enquiry verified against
    // CF_TURNSTILE_SECRET_SITE. If real enquiries start failing, check that both
    // secrets are still set (see turnstileOk) before anything else.
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
    const tsToken = String(body.turnstile_token ?? '')
    if (!(await turnstileOk(tsToken, ip))) {
      console.warn(`turnstile check failed - token ${tsToken ? 'present' : 'missing'}, source ${String(body.source ?? '')}`)
      return json({ error: 'Security check failed. Please refresh the page and try again.' }, 403)
    }

    const company = String(body.company ?? '').trim()
    const postcode = String(body.postcode ?? '').trim()
    const source = String(body.source ?? 'unknown').trim()
    // Two funnels, two vocabularies: the solar funnel sends a platform slug in
    // `niche`, /get-started sends the trade label the visitor picked in `trade`.
    // Either is forwarded as-is and ql-mc maps both; it must NOT be defaulted
    // here, or an HVAC enquiry silently becomes a solar one.
    const nicheSlug = String(body.niche ?? body.trade ?? '').trim()
    const niche = nicheLabel(nicheSlug)
    // The volume they said they want. A qualifying answer, so it goes on the
    // pipeline card as well as into this email.
    const goal = String(body.goal ?? '').trim()

    // The pipeline card first - it is the half a rep actually works from.
    // ql-mc maps the campaign slug onto its own niche vocabulary.
    const onPipeline = await createPipelineLead({
      name, company, email, phone, postcode, source, campaign: nicheSlug, goal,
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
          <p><strong>${esc(name)}</strong> asked for a callback. They were told we would ring ${promisedCall(source)}.</p>
          <table style="border-collapse:collapse;font-size:14px">
            <tr><td style="padding:3px 14px 3px 0;color:#666">Name</td><td>${esc(name)}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666">Company</td><td>${esc(company)}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666">Email</td><td>${esc(email)}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666">Phone</td><td>${esc(phone)}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666">Service area</td><td>${esc(postcode)}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666">Trade / campaign</td><td>${esc(niche)}</td></tr>
            ${goal ? `<tr><td style="padding:3px 14px 3px 0;color:#666">Volume wanted</td><td>${esc(goal)}</td></tr>` : ''}
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

    await sendWelcomeEmail(email, name).catch((e) =>
      console.error('welcome email error:', e instanceof Error ? e.message : e))

    return json({ success: true })
  } catch (err) {
    console.error('callback-request error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
