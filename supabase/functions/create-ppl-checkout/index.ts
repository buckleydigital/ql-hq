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
      company_id,
      niche,
      area_city,
      location_type,
      radius_km,
      postcode_list,
      quantity,
    } = await req.json()

    if (!company_id || !niche || !area_city || !quantity) {
      throw new Error('Missing required fields: company_id, niche, area_city, quantity')
    }

    // Always validate price from DB by niche — never trust client
    const { data: pricing } = await supabase
      .from('ppl_pricing')
      .select('price_per_lead')
      .eq('niche', niche)
      .maybeSingle()

    if (!pricing) throw new Error(`No pricing configured for niche: ${niche}`)

    const validatedPrice = pricing.price_per_lead
    const totalCents = Math.round(validatedPrice * quantity * 100)

    const { data: company } = await supabase
      .from('companies')
      .select('email, name')
      .eq('id', company_id)
      .maybeSingle()

    if (!company) throw new Error('Company not found')

    // Build a readable location description for the Stripe line item
    const locationDesc = location_type === 'postcodes'
      ? `Postcodes: ${(postcode_list || '').replace(/\s+/g, ', ').slice(0, 200)}`
      : `${area_city} — ${radius_km ?? 50}km radius`

    // Create pending order
    const { data: order, error: orderErr } = await supabase
      .from('ppl_lead_orders')
      .insert({
        company_id,
        niche,
        area: area_city,
        area_city,
        location_type: location_type || 'radius',
        radius_km: location_type !== 'postcodes' ? (radius_km ?? 50) : null,
        postcode_list: location_type === 'postcodes' ? postcode_list : null,
        quantity,
        price_per_lead: validatedPrice,
        total_amount: validatedPrice * quantity,
        status: 'pending',
      })
      .select('id')
      .single()

    if (orderErr) throw new Error(`Order creation failed: ${orderErr.message}`)

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: company.email,
      line_items: [{
        price_data: {
          currency: 'aud',
          unit_amount: totalCents,
          product_data: {
            name: `${quantity} ${niche.charAt(0).toUpperCase() + niche.slice(1)} leads`,
            description: `${locationDesc}. Exclusive leads delivered in real-time to your pipeline.`,
          },
        },
        quantity: 1,
      }],
      metadata: {
        type: 'ppl',
        company_id,
        order_id: order!.id,
        niche,
        area_city,
        location_type: location_type || 'radius',
        radius_km: String(radius_km ?? 50),
        quantity: String(quantity),
        price_per_lead: String(validatedPrice),
      },
      success_url: 'https://quoteleadshq.com/dashboard.html?ppl_success=true',
      cancel_url: 'https://quoteleadshq.com/dashboard.html?ppl_cancelled=true',
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
