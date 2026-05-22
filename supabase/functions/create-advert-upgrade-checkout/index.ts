// Advertising system upgrade checkout for existing authenticated companies.
// Called from inside the dashboard by PPL-only companies.
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
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.company_id) return new Response('Company not found', { status: 404 })

    const { data: company } = await supabase
      .from('companies')
      .select('id, name, email, has_advertising_system, stripe_customer_id')
      .eq('id', profile.company_id)
      .maybeSingle()

    if (!company) return new Response('Company not found', { status: 404 })
    if (company.has_advertising_system) {
      return new Response(JSON.stringify({ error: 'Already purchased' }), { status: 400, headers: corsHeaders })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      ...(company.stripe_customer_id
        ? { customer: company.stripe_customer_id }
        : { customer_email: company.email }),
      line_items: [{
        price_data: {
          currency: 'aud',
          unit_amount: 250000, // $2,500.00
          product_data: {
            name: 'QuoteLeads Advertising System',
            description: 'AI SMS agent, Twilio number, Meta/Google ad campaigns, and landing pages.',
          },
        },
        quantity: 1,
        tax_rates: [Deno.env.get('STRIPE_TAX_RATE_GST')!],
      }],
      metadata: {
        type:       'advertising_system_upgrade',
        company_id: company.id,
      },
      success_url: 'https://quoteleadshq.com/dashboard?welcome=advertising',
      cancel_url:  'https://quoteleadshq.com/dashboard',
    })

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('create-advert-upgrade-checkout error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
