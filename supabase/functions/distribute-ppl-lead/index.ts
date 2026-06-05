// distribute-ppl-lead
// Called by ql-mc (or any internal system) with a raw inbound lead + niche + location.
// Finds all active ppl_lead_orders matching that niche/area, creates a lead record
// for each matched company, increments delivered_count, and sends delivery emails.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)
const QL_MC_API_SECRET = Deno.env.get('QL_MC_API_SECRET') || ''
const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-secret',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Auth: accept either service role key OR the shared QL_MC_API_SECRET
  const authHeader  = req.headers.get('authorization') || ''
  const apiSecret   = req.headers.get('x-api-secret')  || ''
  const callerToken = authHeader.replace(/^Bearer\s+/i, '')
  const isServiceRole = callerToken === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const isMcSecret    = QL_MC_API_SECRET.length > 0 && apiSecret === QL_MC_API_SECRET

  if (!isServiceRole && !isMcSecret) return json({ error: 'Unauthorized' }, 401)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON body' }, 400)

  const {
    name, first_name, last_name,
    email, phone, postcode, area_city,
    niche, sub_niche,
    ...rest
  } = body as Record<string, unknown>

  if (!niche || typeof niche !== 'string') return json({ error: 'niche is required' }, 400)

  const resolvedName = (
    typeof name === 'string' && name.trim() ? name.trim()
      : [first_name, last_name].filter((v): v is string => typeof v === 'string' && !!v.trim()).join(' ') || null
  )
  if (!resolvedName && !phone) return json({ error: 'name/first_name or phone is required' }, 400)

  const resolvedFirstName = (typeof first_name === 'string' && first_name.trim())
    ? first_name.trim()
    : resolvedName?.split(' ')[0] || ''
  const resolvedLastName = (typeof last_name === 'string' && last_name.trim())
    ? last_name.trim()
    : (resolvedName?.includes(' ') ? resolvedName.slice(resolvedName.indexOf(' ') + 1) : null)

  const nicheNorm     = niche.toLowerCase().trim()
  const subNicheNorm  = typeof sub_niche === 'string' && sub_niche.trim() ? sub_niche.trim().toLowerCase() : null
  const postcodeStr   = typeof postcode  === 'string' && postcode.trim()  ? postcode.trim()  : null
  const areaCityStr   = typeof area_city === 'string' && area_city.trim() ? area_city.trim().toLowerCase() : null

  // Load all active orders for this niche
  const { data: orders, error: ordersErr } = await supabase
    .from('ppl_lead_orders')
    .select('id, company_id, niche, sub_niche, area_city, location_type, postcode_list, quantity, delivered_count')
    .eq('status', 'active')
    .eq('niche', nicheNorm)

  if (ordersErr) {
    console.error('ppl_lead_orders query error:', ordersErr.message)
    return json({ error: 'Internal error' }, 500)
  }

  // Filter by sub_niche + location + remaining capacity
  const matched = (orders || []).filter(o => {
    // Sub_niche: if order specifies one, it must match; null order accepts everything
    if (o.sub_niche) {
      if (!subNicheNorm || o.sub_niche.toLowerCase() !== subNicheNorm) return false
    }

    // Location
    if (o.location_type === 'postcodes') {
      if (!postcodeStr || !o.postcode_list) return false
      const codes = o.postcode_list.split(/[\s,\n]+/).map((p: string) => p.trim()).filter(Boolean)
      if (!codes.includes(postcodeStr)) return false
    } else {
      // Radius mode: match on area_city (case-insensitive). If order has no area_city, treat as catch-all.
      if (o.area_city && areaCityStr && o.area_city.toLowerCase() !== areaCityStr) return false
    }

    // Capacity
    if ((o.delivered_count || 0) >= o.quantity) return false

    return true
  })

  if (matched.length === 0) {
    console.log(`distribute-ppl-lead: no match — niche=${nicheNorm} area=${areaCityStr} postcode=${postcodeStr}`)
    return json({ success: true, delivered_to: [], message: 'No matching active orders' })
  }

  const deliveredTo: string[] = []

  for (const order of matched) {
    try {
      const customFields: Record<string, unknown> = { niche: nicheNorm, ...rest }
      if (subNicheNorm) customFields.sub_niche = subNicheNorm
      if (area_city)    customFields.area_city  = area_city

      const leadRow: Record<string, unknown> = {
        company_id:     order.company_id,
        name:           resolvedName,
        first_name:     resolvedFirstName,
        last_name:      resolvedLastName || null,
        email:          typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null,
        phone:          typeof phone === 'string' && phone.trim() ? phone.trim() : null,
        postcode:       postcodeStr,
        pipeline_stage: 'new_lead',
        source:         'PPL',
        is_ppl:         true,
        ai_enabled:     true,
        custom_fields:  customFields,
        created_at:     new Date().toISOString(),
      }

      const { error: leadErr } = await supabase.from('leads').insert(leadRow)

      if (leadErr) {
        console.error('lead insert error for company', order.company_id, ':', leadErr.message)
        continue
      }

      // Bump delivered_count on the order row
      await supabase
        .from('ppl_lead_orders')
        .update({ delivered_count: (order.delivered_count || 0) + 1 })
        .eq('id', order.id)

      deliveredTo.push(order.company_id)

      // Fire-and-forget delivery email
      sendLeadEmail(order.company_id, {
        name:      resolvedName,
        email:     typeof email === 'string' ? email.trim() || null : null,
        phone:     typeof phone === 'string' ? phone.trim() || null : null,
        niche:     nicheNorm,
        area_city: areaCityStr,
        postcode:  postcodeStr,
      })
    } catch (err) {
      console.error('Error delivering lead to company', order.company_id, ':', err)
    }
  }

  console.log(`distribute-ppl-lead: delivered niche=${nicheNorm} to ${deliveredTo.length} companies`)
  return json({ success: true, delivered_to: deliveredTo, count: deliveredTo.length })
})

async function sendLeadEmail(
  companyId: string,
  lead: { name: string | null; email: string | null; phone: string | null; niche: string; area_city: string | null; postcode: string | null }
) {
  try {
    const { data: company } = await supabase
      .from('companies')
      .select('name, settings')
      .eq('id', companyId)
      .maybeSingle()

    const deliveryEmail: string | undefined = company?.settings?.lead_delivery?.email
    if (!deliveryEmail) return

    const nicheLabel   = lead.niche.charAt(0).toUpperCase() + lead.niche.slice(1)
    const locationStr  = lead.area_city
      ? lead.area_city.charAt(0).toUpperCase() + lead.area_city.slice(1)
      : lead.postcode ? `Postcode ${lead.postcode}` : 'Unknown area'

    const html = `
      <div style="font-family:system-ui,sans-serif;font-size:14px;color:#333;line-height:1.7;max-width:560px">
        <h2 style="font-size:18px;margin:0 0 16px">🔔 New ${nicheLabel} lead — ${company?.name || 'your account'}</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#666;width:110px">Name</td><td style="padding:6px 0;font-weight:500">${lead.name || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Phone</td><td style="padding:6px 0">${lead.phone || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Email</td><td style="padding:6px 0">${lead.email || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Niche</td><td style="padding:6px 0">${nicheLabel}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Area</td><td style="padding:6px 0">${locationStr}</td></tr>
        </table>
        <p style="margin-top:20px;font-size:12px;color:#999">
          Log in to your <a href="https://quoteleadshq.com/dashboard" style="color:#4797FF">QuoteLeads dashboard</a> to view and action this lead.
        </p>
      </div>`

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'QuoteLeads <leads@quoteleads.com.au>',
        to:      deliveryEmail,
        subject: `New ${nicheLabel} lead — ${lead.name || 'Unknown'} (${locationStr})`,
        html,
      }),
    })
  } catch (err) {
    console.warn('sendLeadEmail error:', err)
  }
}
