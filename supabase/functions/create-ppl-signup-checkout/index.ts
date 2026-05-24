// New-company PPL signup checkout.
// Called from quoteleads.com.au — no auth required.
// Company + user are created by the stripe-webhook on payment completion.
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
      niche,
      area_city,
      location_type,
      radius_km,
      postcode_list,
      quantity,
    } = await req.json()

    if (!first_name || !last_name || !email || !phone || !company || !niche || !area_city || !quantity) {
      throw new Error('Missing required fields')
    }

    const normNiche = (niche as string).toLowerCase().trim().replace(/-/g, '_')

    // Validate price from DB — never trust client
    const { data: areaPrice } = await supabase
      .from('ppl_pricing')
      .select('price_per_lead')
      .eq('niche', normNiche)
      .eq('area', area_city)
      .maybeSingle()

    const pricing = areaPrice ?? (await supabase
      .from('ppl_pricing')
      .select('price_per_lead')
      .eq('niche', normNiche)
      .is('area', null)
      .maybeSingle()
    ).data

    if (!pricing) throw new Error(`No pricing configured for niche: ${normNiche}`)

    const validatedPrice = pricing.price_per_lead

    // Derive discount server-side — never trust a client-supplied value
    const { data: tierRows } = await supabase
      .from('volume_discount_tiers')
      .select('min_quantity, discount_percent')
      .eq('active', true)
      .lte('min_quantity', quantity)
      .order('min_quantity', { ascending: false })
      .limit(1)

    const discountPercent = tierRows?.[0]?.discount_percent ?? 0
    const totalCents = Math.round(validatedPrice * quantity * (1 - discountPercent / 100) * 100)

    // Capture signup attempt before redirecting — persists even if checkout is abandoned
    const { data: attempt } = await supabase
      .from('signup_attempts')
      .insert({
        type: 'ppl_signup',
        first_name, last_name, email, phone, company,
        niche: normNiche, area_city,
        quantity,
        price_per_lead: validatedPrice,
        status: 'pending',
      })
      .select('id')
      .single()

    const locationDesc = location_type === 'postcodes'
      ? `Postcodes: ${(postcode_list || '').replace(/\s+/g, ', ').slice(0, 200)}`
      : `${area_city} — ${radius_km ?? 50}km radius`

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'aud',
          unit_amount: totalCents,
          product_data: {
            name: `${quantity} ${normNiche.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} leads`,
            description: `${locationDesc}. Exclusive leads delivered in real-time to your pipeline.`,
          },
        },
        quantity: 1,
        tax_rates: [Deno.env.get('STRIPE_TAX_RATE_GST')!],
      }],
      metadata: {
        type:          'ppl_signup',
        first_name,
        last_name,
        email,
        phone,
        company,
        niche: normNiche,
        area_city,
        location_type: location_type || 'radius',
        radius_km:     String(radius_km ?? 50),
        postcode_list: postcode_list || '',
        quantity:         String(quantity),
        price_per_lead:   String(validatedPrice),
        discount_percent: String(discountPercent),
      },
      success_url: 'https://quoteleads.com.au/welcome?session_id={CHECKOUT_SESSION_ID}&type=ppl',
      cancel_url:  'https://quoteleads.com.au/buy-leads?cancelled=true',
    })

    // Store session ID on the attempt for cross-referencing
    if (attempt?.id) {
      await supabase.from('signup_attempts').update({ stripe_session_id: session.id }).eq('id', attempt.id)
    }

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('create-ppl-signup-checkout error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
