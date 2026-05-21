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
    const { company_id, niche, area, quantity, price_per_lead } = await req.json()

    // Always validate price from DB — never trust client
    const { data: pricing } = await supabase
      .from('ppl_pricing')
      .select('price_per_lead')
      .eq('niche', niche)
      .eq('area', area)
      .eq('is_active', true)
      .maybeSingle()

    if (!pricing) throw new Error('Pricing not found for this niche/area combination')

    const validatedPrice = pricing.price_per_lead
    const totalCents = Math.round(validatedPrice * quantity * 100)

    const { data: company } = await supabase
      .from('companies')
      .select('email, name')
      .eq('id', company_id)
      .maybeSingle()

    if (!company) throw new Error('Company not found')

    // Create pending order
    const { data: order } = await supabase
      .from('ppl_lead_orders')
      .insert({
        company_id,
        niche,
        area,
        quantity,
        price_per_lead: validatedPrice,
        total_amount: validatedPrice * quantity,
        status: 'pending',
      })
      .select('id')
      .single()

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: company.email,
      line_items: [{
        price_data: {
          currency: 'aud',
          unit_amount: totalCents,
          product_data: {
            name: `${quantity} ${niche} leads — ${area}`,
            description: `Pay Per Lead pack: ${quantity} exclusive ${niche} leads in ${area}. Delivered in real-time to your pipeline.`,
          },
        },
        quantity: 1,
      }],
      metadata: {
        type: 'ppl',
        company_id,
        order_id: order!.id,
        niche,
        area,
        quantity: String(quantity),
        price_per_lead: String(validatedPrice),
      },
      success_url: 'https://quoteleadshq.com/dashboard?ppl_success=true',
      cancel_url: 'https://quoteleadshq.com/dashboard?ppl_cancelled=true',
    })

    await supabase
      .from('ppl_lead_orders')
      .update({ stripe_session_id: session.id })
      .eq('id', order!.id)

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('create-ppl-checkout error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
