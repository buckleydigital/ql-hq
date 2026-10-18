import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14'
import '../_shared/no-em-dash.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY')!, { apiVersion: '2024-04-10' })

// The Branded Lead Gen System, bought online from /buy-system on
// quoteleads.com.au. Two builds, priced in cents (AUD) ex GST; GST is added at
// checkout. Must stay in step with the prices on /buy-system,
// /branded-solar-lead-system and /pricing, and with the offer emails in ql-mc.
//
// This used to read a Stripe price ID from STRIPE_PRICE_MANAGED, which still
// pointed at a $999 price long after the site moved to $2,500, so checkout
// silently charged the old amount. Keeping the figure here means it lives
// alongside the copy it has to match and shows up in review.
const INSTALL_FEE_CENTS = 250_000

// Pricing keyed by a plan name the page sends. The amount is never taken from
// the request body - the client sends a key, the server owns the figure - so a
// tampered payload cannot change what is charged. A key not in this map is
// refused. The August promotional key
// (promo1250) was removed when the promotion ended: leaving it in place would
// have let a crafted request keep buying at the discount.
//   standard  one campaign, one service area, up to $100/day ad spend
//   growth    more than $100/day, more than one campaign (a second offer or
//             service area), or Google as well as Meta
// monthly is the optional management fee after the first 30 days, ex GST; the
// webhook records it on the company so the later subscription bills it.
const PLANS: Record<string, { cents: number; monthly: number; label: string; description: string }> = {
  standard: {
    cents: INSTALL_FEE_CENTS,
    monthly: 690,
    label: 'Branded Lead Gen System - Standard build',
    description: 'One campaign, one service area, up to $100/day ad spend. Built and launched on your own accounts, with your first 30 days of management. Ad spend paid direct to Meta.',
  },
  growth: {
    cents: 500_000,
    monthly: 1200,
    label: 'Branded Lead Gen System - Growth build',
    description: 'Several campaigns, service areas or offers, Meta and Google, or spend past $100/day. Built and launched on your own accounts, with your first 30 days of management. Ad spend paid direct to Meta/Google.',
  },
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

    // An unknown plan is refused rather than charged at a default: whoever
    // sent it would otherwise pay for a build they did not pick.
    const planKey = typeof formData.plan === 'string' && formData.plan ? formData.plan : 'standard'
    const plan = PLANS[planKey]
    if (!plan) {
      return new Response(JSON.stringify({ error: `Unknown build: ${planKey}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    if (!formData.email || !formData.company || !formData.phone) {
      return new Response(JSON.stringify({ error: 'Name, business, email and phone are required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const unitAmount = plan.cents
    metadata.plan = planKey
    metadata.plan_label = plan.label
    metadata.amount_charged = String(unitAmount / 100)
    metadata.management_fee = String(plan.monthly)

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'aud',
          unit_amount: unitAmount,
          product_data: { name: plan.label, description: plan.description },
        },
        quantity: 1,
        // The price is ex GST, so GST goes on top, the same as the lead packs.
        tax_rates: [Deno.env.get('STRIPE_TAX_RATE_GST')!],
      }],
      customer_email: formData.email,
      // A Stripe customer for the buyer, so the billing portal and the later
      // management subscription hang off the same record. Payment mode does not
      // make one unless asked.
      customer_creation: 'always',
      metadata,
      success_url: `https://quoteleads.com.au/payment-success?session_id={CHECKOUT_SESSION_ID}&plan=${planKey}`,
      cancel_url: `https://quoteleads.com.au/buy-system?tier=${planKey}&cancelled=true`,
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
            <p><strong>${name}</strong> started a checkout for the ${plan.label} ($${(unitAmount / 100).toLocaleString('en-AU')} + GST). Not paid yet.</p>
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
