import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14'

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY')!, { apiVersion: '2024-04-10' })

// The Ad-Ready setup, bought from the standalone /ad-ready page on
// quoteleads.com.au. Kept apart from create-checkout so the build checkouts
// are never touched by changes here.
//
// One checkout in subscription mode: the $499 setup goes on the first invoice
// as a one-off item, charged today, and the $49/mo plan starts after a 30-day
// trial so the first monthly charge lands in month 2. Both are ex GST, with
// GST added at checkout. Must stay in step with the figures on /ad-ready.
//
// metadata.type is 'ad_ready' on both the session and the subscription:
// stripe-webhook has no case for it and only manages subscriptions typed
// 'management', so nothing is provisioned automatically. Delivery is manual.
const SETUP_CENTS = 49_900
const MONTHLY_CENTS = 4_900

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const gst = Deno.env.get('STRIPE_TAX_RATE_GST')!
    const metadata = { type: 'ad_ready', source: 'ad-ready' }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'aud',
            unit_amount: SETUP_CENTS,
            product_data: {
              name: 'Ad-Ready setup',
              description: 'Website, ad landing page, Google Business Profile, review campaign, review bot, 5+ directory listings, tracking, Meta setup and privacy policy. One-off.',
            },
          },
          quantity: 1,
          tax_rates: [gst],
        },
        {
          price_data: {
            currency: 'aud',
            unit_amount: MONTHLY_CENTS,
            recurring: { interval: 'month' },
            product_data: {
              name: 'Ad-Ready monthly',
              description: 'Website hosting and updates, review bot, and Google profile and listings upkeep. Cancel any time.',
            },
          },
          quantity: 1,
          tax_rates: [gst],
        },
      ],
      phone_number_collection: { enabled: true },
      custom_fields: [{
        key: 'business_name',
        label: { type: 'custom', custom: 'Business name' },
        type: 'text',
      }],
      metadata,
      subscription_data: { metadata, trial_period_days: 30 },
      success_url: 'https://quoteleads.com.au/ad-ready?paid=1',
      cancel_url: 'https://quoteleads.com.au/ad-ready?cancelled=1',
      allow_promotion_codes: true,
    })

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('create-ad-ready-checkout error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
