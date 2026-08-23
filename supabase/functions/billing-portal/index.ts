// Stripe billing portal session for authenticated dashboard users.
//
// This is what makes "cancel any time" real: the client updates their card,
// downloads invoices and cancels management themselves, without anyone here
// having to action a request. Cancellation flows back in through the
// customer.subscription.updated / .deleted webhook events.
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
      .from('companies').select('stripe_customer_id').eq('id', profile.company_id).maybeSingle()

    // No Stripe customer means nothing has ever been charged for this company,
    // so there is no portal to open.
    if (!company?.stripe_customer_id) {
      return new Response(
        JSON.stringify({ error: 'no_billing_account', message: 'No billing account yet.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   company.stripe_customer_id,
      return_url: 'https://quoteleadshq.com/dashboard?page=billing',
    })

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('billing-portal error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
