// Ongoing management subscription checkout ($600/mo) for authenticated
// dashboard users.
//
// This is the only recurring charge in the platform. Everything else -
// the build fee, lead packs, SMS credits - is mode:'payment'. Management is
// mode:'subscription' because it is the one thing the client keeps paying for,
// and because a card on file is what makes "cancel any time" true rather than
// a promise someone has to action by hand.
//
// The client reaches this after their included 30 days, from the Management
// card in the dashboard. The amount is owned here, never taken from the
// request body.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY')!, { apiVersion: '2024-04-10' })
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// The standard fee, $600/mo ex GST. Must stay in step with the figure quoted on
// /pricing and on the funnel's price note.
//
// A client can be on a different number: companies.management_fee_cents. NULL
// there means "the standard fee", so changing this constant moves every client
// who has not been given a specific price, which is the behaviour you want when
// the list price changes.
const MANAGEMENT_CENTS = 60_000

// Statuses that mean Stripe is already billing this company, so sending them
// to a second checkout would double-charge them.
const LIVE_STATUSES = ['active', 'trialing', 'past_due']

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response('Unauthorized', { status: 401 })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return new Response('Unauthorized', { status: 401 })

    const { data: profile } = await supabase
      .from('profiles').select('company_id').eq('id', user.id).maybeSingle()
    if (!profile?.company_id) return new Response('Company not found', { status: 404 })

    const { data: company } = await supabase
      .from('companies')
      .select('id, name, email, stripe_customer_id, management_status, management_subscription_id, management_fee_cents')
      .eq('id', profile.company_id)
      .maybeSingle()
    if (!company) return new Response('Company not found', { status: 404 })

    // Already subscribed. Send them to the billing portal instead of taking a
    // second $600 a month off the same business.
    if (company.management_status && LIVE_STATUSES.includes(company.management_status)) {
      return new Response(
        JSON.stringify({
          error: 'already_subscribed',
          message: 'Management is already active on this account.',
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Reuse the Stripe customer created by the build purchase where we have
    // one, so management bills against the same customer record and the
    // portal shows their whole history in one place.
    let customerId = company.stripe_customer_id as string | null
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: company.email ?? undefined,
        name:  company.name ?? undefined,
        metadata: { company_id: company.id },
      })
      customerId = customer.id
      await supabase
        .from('companies')
        .update({ stripe_customer_id: customerId })
        .eq('id', company.id)
    }

    // The agreed price for this client, or the standard one. Validated rather
    // than trusted: the column is constrained in the database, but a bad value
    // here would create a real Stripe subscription at the wrong price, so a
    // non-integer or negative falls back instead of billing something absurd.
    const raw = company.management_fee_cents
    const feeCents =
      typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 5_000_000
        ? raw
        : MANAGEMENT_CENTS

    // Stripe will not create a recurring price of $0. A client on free
    // management should simply not be sent to checkout - say so plainly rather
    // than letting Stripe return something cryptic.
    if (feeCents === 0) {
      return new Response(
        JSON.stringify({
          error: 'zero_fee',
          message: 'Management is set to $0/mo for this account, so there is nothing to subscribe to. Speak to us if that is wrong.',
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customerId,
      line_items: [{
        price_data: {
          currency: 'aud',
          unit_amount: feeCents,
          recurring: { interval: 'month' },
          product_data: {
            name: 'Campaign Management',
            description:
              'Ongoing management of your Branded Lead Gen System: creative, targeting and optimisation. Month to month, cancel any time. Ad spend is paid direct to Meta from your own account.',
          },
        },
        quantity: 1,
        tax_rates: [Deno.env.get('STRIPE_TAX_RATE_GST')!],
      }],
      // Read by the webhook to tie the subscription back to the company.
      metadata: {
        type:       'management',
        company_id: company.id,
      },
      subscription_data: {
        metadata: {
          type:       'management',
          company_id: company.id,
        },
      },
      success_url: 'https://quoteleadshq.com/dashboard?page=billing&management_started=true',
      cancel_url:  'https://quoteleadshq.com/dashboard?page=billing',
    })

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('create-management-subscription error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
