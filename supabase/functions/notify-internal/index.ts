import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!

serve(async (req) => {
  const { subject, body } = await req.json()

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'QuoteLeads System <system@quoteleads.com.au>',
      to: 'contact@quoteleads.com.au',
      subject,
      html: body,
    }),
  })

  return new Response('OK', { status: 200 })
})
