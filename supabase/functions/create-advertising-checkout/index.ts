// New-company signup checkout for the $2,500 advertising system.
// Called from quoteleads.com.au — no auth required.
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
    const {
      first_name,
      last_name,
      email,
      phone,
      company,
      industry,
      service_location,
      service_radius,
      special_offers,
      products_brands,
    } = await req.json()

    if (!first_name || !last_name || !email || !phone || !company || !industry || !service_location) {
      throw new Error('Missing required fields')
    }

    // Capture signup attempt before redirecting — persists even if checkout is abandoned
    const { data: attempt } = await supabase
      .from('signup_attempts')
      .insert({
        type: 'advertising_system',
        first_name, last_name, email, phone, company,
        industry, service_location, service_radius,
        special_offers: special_offers || null,
        status: 'pending',
      })
      .select('id')
      .single()

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'aud',
          unit_amount: 250000, // $2,500.00
          product_data: {
            name: 'QuoteLeads Advertising System',
            description: 'One-time setup — AI SMS agent, Twilio number, Meta/Google ad campaigns, and landing pages.',
          },
        },
        quantity: 1,
        tax_rates: [Deno.env.get('STRIPE_TAX_RATE_GST')!],
      }],
      metadata: {
        type: 'advertising_system',
        first_name,
        last_name,
        email,
        phone,
        company,
        industry,
        service_location,
        service_radius:   service_radius  || '',
        special_offers:   special_offers  || '',
        products_brands:  products_brands || '',
      },
      success_url: 'https://quoteleadshq.com/dashboard?welcome=advertising',
      cancel_url:  'https://quoteleads.com.au/advertising-system?cancelled=true',
    })

    if (attempt?.id) {
      await supabase.from('signup_attempts').update({ stripe_session_id: session.id }).eq('id', attempt.id)
    }

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('create-advertising-checkout error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
