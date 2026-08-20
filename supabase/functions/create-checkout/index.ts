import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14'

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY')!, { apiVersion: '2024-04-10' })

// Installation fee for the Branded Lead Gen System, in cents (AUD), ex GST.
// Must stay in step with the advertised price on quoteleads.com.au - the site
// quotes "$2,500 + GST" on /pricing, /get-started and the home page.
//
// This used to read a Stripe price ID from STRIPE_PRICE_MANAGED, which still
// pointed at a $999 price long after the site moved to $2,500, so checkout
// silently charged the old amount. Keeping the figure here means it lives
// alongside the copy it has to match and shows up in review.
const INSTALL_FEE_CENTS = 250_000

// Promotional pricing, keyed by a plan name the page sends. The amount is never
// taken from the request body - the client sends a key, the server owns the
// figure - so a tampered payload cannot change what is charged. Anything not in
// this map falls back to the standard install fee above.
const PLAN_PRICES: Record<string, number> = {
  standard: INSTALL_FEE_CENTS,
  // /branded-solar-lead-system funnel, $1,250 promotional build. Must stay in step
  // with the price quoted on that page and in /promotional-terms.
  promo1250: 125_000,
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const formData = await req.json()

    // Stripe metadata values must be strings under 500 chars
    const metadata: Record<string, string> = {}
    for (const [key, value] of Object.entries(formData)) {
      if (value !== null && value !== undefined) {
        const str = Array.isArray(value) ? value.join(', ') : String(value)
        metadata[key] = str.slice(0, 500)
      }
    }
    // Route to the managed/DFY handler in stripe-webhook (provision + notify).
    metadata.type = 'managed'

    const planKey = typeof formData.plan === 'string' ? formData.plan : 'standard'
    const unitAmount = PLAN_PRICES[planKey] ?? INSTALL_FEE_CENTS
    metadata.plan = planKey
    metadata.amount_charged = String(unitAmount / 100)

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'aud',
          unit_amount: unitAmount,
          product_data: {
            name: 'QuoteLeads Installation Fee',
            description: 'Complete AI lead generation system - custom Meta & Google campaigns, landing page, AI SMS agent, CRM pipeline, 30 days optimisation. Ad spend separate.',
          },
        },
        quantity: 1,
      }],
      customer_email: formData.email,
      metadata,
      success_url: 'https://quoteleads.com.au/payment-success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://quoteleads.com.au/get-started?cancelled=true',
      allow_promotion_codes: true,
    })

    // Notify ops that someone started a DFY checkout (before payment completes,
    // so we capture the interest even if they abandon Stripe). Fire-and-forget.
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    if (RESEND_API_KEY) {
      const name = [metadata.first_name, metadata.last_name].filter(Boolean).join(' ') || metadata.name || '(no name)'
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'QuoteLeads System <system@quoteleads.com.au>',
          to: 'contact@quoteleads.com.au',
          subject: `🟡 DFY checkout started - ${metadata.company || metadata.email || name}`,
          html: `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#333;line-height:1.7">
            <p><strong>${name}</strong> started a Branded Lead Gen System (${unitAmount / 100}) checkout. Not paid yet.</p>
            <table style="border-collapse:collapse;font-size:14px">
              <tr><td style="padding:3px 14px 3px 0;color:#666">Company</td><td>${metadata.company || '-'}</td></tr>
              <tr><td style="padding:3px 14px 3px 0;color:#666">Email</td><td>${metadata.email || '-'}</td></tr>
              <tr><td style="padding:3px 14px 3px 0;color:#666">Phone</td><td>${metadata.phone || '-'}</td></tr>
              <tr><td style="padding:3px 14px 3px 0;color:#666">Trade</td><td>${metadata.trade || metadata.niche || '-'}</td></tr>
              <tr><td style="padding:3px 14px 3px 0;color:#666">Lead goal</td><td>${metadata.monthly_lead_goal || '-'}</td></tr>
            </table>
            <p style="color:#999;margin-top:12px">You'll get a second email if/when the payment completes.</p>
          </div>`,
        }),
      }).catch((e) => console.error('checkout-started email error:', e))
    }

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('create-checkout error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
