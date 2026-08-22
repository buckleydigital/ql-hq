import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!

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
            <tr><td style="padding:3px 14px 3px 0;color:#666">Source</td><td>${esc(source)}</td></tr>
          </table>
        </div>`,
      }),
    })

    if (!res.ok) {
      console.error('resend error:', await res.text())
      return json({ error: 'Could not send the request.' }, 502)
    }

    return json({ success: true })
  } catch (err) {
    console.error('callback-request error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
