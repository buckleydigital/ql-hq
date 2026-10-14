import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'
import { isPplNiche, pplMinQuantity, PPL_TRIAL_MIN } from '../_shared/ppl-niches.ts'
import { buildPplAreas, summarisePplAreas, type PplArea } from '../_shared/ppl-areas.ts'

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
    // Reorders are for signed-in pay-per-lead accounts only: the caller must
    // belong to the company (or be a platform admin) and the company must be
    // on the 'ppl' plan.
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    const { data: { user } } = token ? await supabase.auth.getUser(token) : { data: { user: null } }
    if (!user) {
      return new Response(JSON.stringify({ error: 'Please sign in again.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const {
      company_id,
      niche,
      sub_niche,
      area_city,
      location_type,
      radius_km,
      postcode_list,
      quantity,
      service_areas,
      dry_run,
    } = await req.json()
    // quantity is per area: each suburb (or the postcode list, or the state)
    // becomes its own order with that many leads.
    // dry_run prices the order for the form's summary and creates nothing.
    const quoteOnly = dry_run === true

    // Pay-per-lead orders can be paused from platform_settings.ppl_orders_paused.
    // Nothing is created and nobody is charged while they are.
    const { data: settings } = await supabase
      .from('platform_settings').select('ppl_orders_paused').eq('id', 1).maybeSingle()
    if (!quoteOnly && settings?.ppl_orders_paused === true) {
      return new Response(
        JSON.stringify({ error: 'Pay-per-lead orders are paused at the moment. Please contact us on contact@quoteleads.com.au.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!company_id || !niche || !area_city || !quantity) {
      throw new Error('Missing required fields: company_id, niche, area_city, quantity')
    }

    const { data: caller } = await supabase
      .from('profiles').select('company_id, is_admin').eq('id', user.id).maybeSingle()
    if (!caller || (caller.company_id !== company_id && caller.is_admin !== true)) {
      return new Response(JSON.stringify({ error: 'Not allowed to order for this account.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const minQty = await pplMinQuantity(supabase, company_id)
    const normNiche    = (niche as string).toLowerCase().trim().replace(/-/g, '_')
    const normSubNiche = sub_niche ? (sub_niche as string).toLowerCase().trim().replace(/-/g, '_') : null
    if (!isPplNiche(normNiche)) throw new Error(`Pay per lead is not offered for: ${normNiche}`)

    // Prices, caps, minimums and discounts all come from the database here.
    let areas: PplArea[]
    try {
      areas = await buildPplAreas(supabase, {
        niche: normNiche, subNiche: normSubNiche, areaCity: area_city,
        locationType: location_type || 'radius', radiusKm: radius_km, postcodeList: postcode_list,
        serviceAreas: service_areas, quantity: Number(quantity), minQuantity: minQty,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const hint = Number(quantity) < minQty
        ? (minQty === PPL_TRIAL_MIN ? ` Your first order (a trial) is a minimum of ${minQty} leads per area.` : ` Re-orders are a minimum of ${minQty} leads per area.`)
        : ''
      return new Response(JSON.stringify({ error: msg + hint }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (quoteOnly) {
      return new Response(JSON.stringify({
        areas: areas.map((a) => ({
          label: a.label, city: a.city, quantity: a.quantity, price_per_lead: a.price_per_lead,
          discount_percent: a.discount_percent, total_amount: a.total_amount, postcode_count: a.postcodes.length,
        })),
        total_quantity: areas.reduce((n, a) => n + a.quantity, 0),
        total_ex_gst: Math.round(areas.reduce((n, a) => n + a.total_amount, 0) * 100) / 100,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { data: company } = await supabase
      .from('companies')
      .select('email, name, plan')
      .eq('id', company_id)
      .maybeSingle()

    if (!company) throw new Error('Company not found')
    if (company.plan !== 'ppl') {
      return new Response(JSON.stringify({ error: 'Lead packs are only available on pay-per-lead accounts.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const nicheDisplay = [normNiche, normSubNiche]
      .filter(Boolean)
      .map(s => s!.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '))
      .join(' › ')

    // One pending order per area. area is the city it is priced at; area_city
    // is the area as the buyer sees it.
    const { data: orders, error: orderErr } = await supabase
      .from('ppl_lead_orders')
      .insert(areas.map((a) => ({
        company_id,
        niche: normNiche,
        sub_niche: normSubNiche,
        area: a.city,
        area_city: a.label,
        location_type: a.location_type,
        radius_km: a.radius_km,
        postcode_list: a.postcode_list,
        ...(a.service_area && { service_areas: [a.service_area] }),
        postcodes: a.postcodes,
        quantity: a.quantity,
        price_per_lead: a.price_per_lead,
        total_amount: a.total_amount,
        status: 'pending',
      })))
      .select('id')

    if (orderErr || !orders?.length) throw new Error(`Order creation failed: ${orderErr?.message || 'no rows'}`)
    const orderIds = orders.map((o: { id: string }) => o.id)
    const totalQty = areas.reduce((n, a) => n + a.quantity, 0)

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      ...(company.email ? { customer_email: company.email } : {}),
      line_items: areas.map((a) => ({
        price_data: {
          currency: 'aud',
          unit_amount: Math.round(a.total_amount * 100),
          product_data: {
            name: `${a.quantity} ${nicheDisplay} leads - ${a.label}`.slice(0, 250),
            description: `Priced at the ${a.city} rate${a.discount_percent ? `, ${a.discount_percent}% volume discount` : ''}. Exclusive leads delivered in real-time to your pipeline.`,
          },
        },
        quantity: 1,
        tax_rates: [Deno.env.get('STRIPE_TAX_RATE_GST')!],
      })),
      metadata: {
        type: 'ppl',
        company_id,
        order_id:         orderIds[0],
        order_ids:        orderIds.join(','),
        niche:            normNiche,
        sub_niche:        normSubNiche || '',
        area_city,
        location_type:    location_type || 'radius',
        radius_km:        String(radius_km ?? 50),
        service_areas_summary: summarisePplAreas(areas).slice(0, 500),
        quantity:         String(totalQty),
        price_per_lead:   String(areas[0].price_per_lead),
        discount_percent: String(areas[0].discount_percent),
      },
      success_url: 'https://quoteleadshq.com/dashboard.html?ppl_success=true',
      cancel_url:  'https://quoteleadshq.com/dashboard.html?ppl_cancelled=true',
    })

    await supabase
      .from('ppl_lead_orders')
      .update({ stripe_session_id: session.id })
      .in('id', orderIds)

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
