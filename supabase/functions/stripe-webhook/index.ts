import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'
import { summariseServiceAreas, type ServiceArea } from '../_shared/service-areas.ts'
import type { PplArea } from '../_shared/ppl-areas.ts'
import { pplNicheDisplay } from '../_shared/ppl-niches.ts'
import '../_shared/no-em-dash.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY')!, { apiVersion: '2024-04-10' })
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)
const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY')!
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
// ql-mc cross-service sync - must be set in Supabase Dashboard → Edge Functions → Secrets
const QL_MC_API_URL    = Deno.env.get('QL_MC_API_URL')    // https://<mc-project>.supabase.co/functions/v1
const QL_MC_API_SECRET = Deno.env.get('QL_MC_API_SECRET') // shared secret for ql-hq → ql-mc HTTP calls

serve(async (req) => {
  // growth-onboarding, once it has created a buyer's account: apply the system
  // they paid for. Service-role only; a public caller gets nothing from it.
  if (req.headers.get('x-claim-purchase')) {
    const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!bearer || bearer !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return new Response('Forbidden', { status: 403 })
    const { email } = await req.json().catch(() => ({})) as { email?: string }
    const out = await claimManagedPurchase(String(email || ''))
    return new Response(JSON.stringify(out), { status: out.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } })
  }

  const sig  = req.headers.get('stripe-signature')!
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature failed:', err)
    return new Response('Unauthorized', { status: 401 })
  }

  // Subscription lifecycle for the monthly management plan. These arrive
  // outside checkout - renewals, card failures, cancellations from the billing
  // portal - so they are handled before the checkout branch below.
  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    await handleManagementSubscriptionChange(event.data.object as Stripe.Subscription, event.type)
    return new Response('OK', { status: 200 })
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response('OK', { status: 200 })
  }

  // Stripe can deliver the same event more than once (retries, timeouts).
  // Record each checkout event before acting on it so a repeat delivery can't
  // add credits or create an order twice. If the insert fails for any other
  // reason, carry on rather than drop a paid order.
  const { error: seenErr } = await supabase
    .from('stripe_webhook_events')
    .insert({ id: event.id, type: event.type })
  if (seenErr?.code === '23505') {
    console.log('Duplicate Stripe event ignored:', event.id)
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (seenErr) console.error('stripe_webhook_events insert error:', seenErr.message)

  const session = event.data.object as Stripe.Checkout.Session
  const m = session.metadata || {}

  switch (m.type) {
    case 'ppl':
      await handlePplPayment(session, m)
      break
    case 'ppl_signup':
      await handlePplSignupPayment(session, m)
      break
    case 'sms_credits':
      await handleSmsCreditsTopUp(session, m)
      break
    case 'managed':
      await handleManagedSignupPayment(session, m)
      break
    // 'management' needs no work here: the subscription events above carry the
    // billing state, and they fire for the initial checkout too.
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

// ── Shared helpers ─────────────────────────────────────────────────────────────

async function provisionTwilio(companyId: string) {
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/provision-twilio`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({ company_id: companyId }),
  }).catch(err => console.error('provision-twilio error:', err))
}

async function createMagicLink(email: string, page?: string): Promise<string> {
  // `page` deep links into a dashboard section, e.g. 'onboarding' so a new
  // managed client lands on the Meta access steps rather than a blank Status
  // page with nothing to do yet.
  const redirectTo = page
    ? `https://quoteleadshq.com/dashboard?page=${encodeURIComponent(page)}`
    : 'https://quoteleadshq.com/dashboard'
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo, expiresIn: 86400 },
  })
  if (error) throw new Error(`Magic link: ${error.message}`)
  return data.properties.action_link
}

function buildSmsPrompts(company: string, niche: string): { system_prompt: string; welcome_message: string } {
  const system_prompt =
    `Use natural Australian English, not American English.

Never quote specific prices or guarantees - always defer to the team. For financing specifics, defer to the team.

Never use an em dash or en dash. Use a comma, a full stop or a plain hyphen.

If someone says not interested, acknowledge it politely and close the conversation.

Escalate to a human immediately if: the lead mentions a complaint, asks about an existing job, mentions anything legal or billing related, or asks for the owner or manager. Do not attempt to handle these yourself.`

  const welcome_message =
    `Hi, thanks for reaching out to ${company}. We just wanted to confirm you're looking for a ${niche} quote - is that correct?`

  return { system_prompt, welcome_message }
}

function buildSystemPrompt(m: Record<string, string>): string {
  return `You are a friendly and professional sales assistant for ${m.company}, a ${m.industry} business based in ${m.service_location}.

Your job is to qualify inbound leads via SMS. Keep messages short, warm and conversational - never more than 2-3 sentences.

Key details:
- Business: ${m.company}
- Industry: ${m.industry}
- Service area: ${m.service_location} within ${m.service_radius}
${m.special_offers   ? `- Current offers: ${m.special_offers}`     : ''}
${m.products_brands  ? `- Products/brands: ${m.products_brands}`   : ''}

Goals in order:
1. Confirm what the lead needs and their name
2. Qualify their timeline and rough budget
3. Book a callback or on-site visit
4. If ready, initiate a quote

Always be helpful, never pushy. Never use an em dash or en dash. Sign off as the ${m.company} team.`
}

async function insertSmsAgentConfig(companyId: string, m: Record<string, string>) {
  await supabase.from('sms_agent_config').insert({
    company_id:               companyId,
    model:                    'gpt-4o',
    is_active:                true,
    auto_reply:               true,
    out_of_hours_only:        false,
    callback_enabled:         true,
    onsite_enabled:           false,
    quote_drafting_enabled:   false,
    lead_scoring_enabled:     true,
    auto_send_welcome:        false,
    agent_name:               'Alex',
    reply_delay_seconds:      8,
    max_sms_words:            60,
    special_offers:           m.special_offers  || null,
    service_locations:        [m.service_location].filter(Boolean),
    max_travel_distance:      50,
    max_travel_distance_unit: 'km',
    callback_hours_start:     '08:00',
    callback_hours_end:       '18:00',
    welcome_message:          `Hi {{first_name}}, thanks for reaching out to ${m.company}! We'll be in touch shortly.`,
    automate_quote_followup:  true,
    days_until_followup:      3,
    followup_message:         `Hi {{first_name}}, just following up on your quote. Let us know if you have any questions!`,
    quote_pricing_config: {
      items:    [],
      tax_rate: 10,
      tax_mode: 'exclusive',
      currency: 'AUD',
      formula:  m.products_brands ? `Products/brands: ${m.products_brands}` : '',
    },
    system_prompt: buildSystemPrompt(m),
  })
}

// ── ql-mc sync: create/update PPL client + log order ──────────────────────────
//
// Calls ql-mc’s sync-from-hq edge function via HTTP.
// Fire-and-forget on failure - ql-hq provisioning must not be blocked by ql-mc.
async function syncPplOrderToMc(params: {
  companyId:       string
  companyName:     string
  contactName:     string
  email:           string
  phone:           string
  quantity:        number
  pricePerLead:    number
  niche:           string
  subNiche:        string | null
  areaCity:        string
  locationTypeVal: string
  radiusKm:        number
  postcodeList:    string
  qlHqOrderId:     string
  // The company's open area postcodes, when every active order is split into
  // areas; Mission Control routes on these. Omitted otherwise.
  postcodes?:      string[] | null
}) {
  if (!QL_MC_API_URL || !QL_MC_API_SECRET) {
    console.warn('QL_MC_API_URL or QL_MC_API_SECRET not configured - skipping ql-mc sync')
    return
  }

  try {
    const res = await fetch(`${QL_MC_API_URL}/sync-from-hq`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': QL_MC_API_SECRET,
      },
      body: JSON.stringify({
        action:           'upsert_ppl_client',
        ql_hq_company_id: params.companyId,
        company_name:     params.companyName,
        contact_name:     params.contactName,
        email:            params.email,
        phone:            params.phone,
        niche:            params.niche,
        sub_niche:        params.subNiche,
        area_city:        params.areaCity,
        quantity:         params.quantity,
        price_per_lead:   params.pricePerLead,
        location_type:    params.locationTypeVal,
        radius_km:        params.radiusKm,
        postcode_list:    params.postcodeList,
        ql_hq_order_id:   params.qlHqOrderId,
        ...(params.postcodes ? { postcodes: params.postcodes } : {}),
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`ql-mc sync-from-hq returned ${res.status}: ${text}`)
    } else {
      const result = await res.json()
      console.log(`ql-mc client ${result.action || 'synced'} for company:`, params.companyId)
    }
  } catch (err) {
    console.error('syncPplOrderToMc HTTP error:', err)
  }
}

// The postcodes a company's open area orders deliver to, for Mission Control's
// routing. null while an older, unsplit order is still active: then the
// postcodes set by hand in Mission Control are left as they are.
async function openAreaPostcodes(companyId: string): Promise<string[] | null> {
  const { data } = await supabase
    .from('ppl_lead_orders').select('postcodes, quantity, delivered_count')
    .eq('company_id', companyId).eq('status', 'active')
  if (!data?.length || data.some((o) => !o.postcodes)) return null
  return [...new Set(data.filter((o) => o.delivered_count < o.quantity).flatMap((o) => o.postcodes as string[]))].sort()
}

type AreaOrderRow = {
  id: string; location_type: string | null; postcode_list: string | null; service_areas: ServiceArea[] | null
  area: string | null; area_city: string | null; quantity: number; price_per_lead: number; total_amount: number | null
  radius_km: number | null
}

function areaRowsHtml(rows: AreaOrderRow[]): string {
  return rows.map((o) => `<tr><td style="padding:4px 12px 4px 0;color:#666">Area</td><td>${o.area_city || o.area || '-'}: <strong>${o.quantity} leads</strong> at $${Number(o.price_per_lead).toFixed(2)}${o.area && o.area !== o.area_city ? ` (${o.area} rate)` : ''}</td></tr>`).join('')
}

// ── PPL payment (existing company buying more leads) ─────────────────────────
async function handlePplPayment(session: Stripe.Checkout.Session, m: Record<string, string>) {
  // One order per area: order_ids lists them all; order_id alone is an order
  // placed before areas were split out.
  const ids = (m.order_ids || m.order_id || '').split(',').map((x) => x.trim()).filter(Boolean)
  console.log('PPL payment for orders:', ids.join(', '))
  try {
    const { data: activated, error: activateErr } = await supabase
      .from('ppl_lead_orders')
      .update({ status: 'active', stripe_payment_intent_id: session.payment_intent as string })
      .in('id', ids)
      .select('id')
    // Paid but not activated: alert, then still record and sync the orders so
    // fulfilment isn't held up while someone fixes the order rows.
    if (activateErr || (activated?.length ?? 0) < ids.length) {
      const reason = activateErr ? activateErr.message : `${activated?.length ?? 0} of ${ids.length} order rows found`
      console.error('ppl_lead_orders activate failed:', ids.join(','), reason)
      await sendInternalEmail(
        `⚠️ PPL order paid but not activated - ${ids.length} area order(s)`,
        `<p>Reason: ${reason}</p><p>Order IDs: ${ids.join(', ')}</p><p>Company ID: ${m.company_id}</p><p>Stripe session: ${session.id}</p>`
      )
    }

    const { data: orderRows } = await supabase
      .from('ppl_lead_orders')
      .select('id, location_type, postcode_list, service_areas, area, area_city, quantity, price_per_lead, total_amount, radius_km')
      .in('id', ids)
    const orders = (orderRows || []) as AreaOrderRow[]

    // Postcode-list areas also go onto the company's agreed postcodes.
    const listed = orders.filter((o) => o.location_type === 'postcodes' && o.postcode_list)
      .flatMap((o) => String(o.postcode_list).split(/[\s,\n]+/).map((p) => p.trim()).filter(Boolean))
    if (listed.length) {
      const { data: companyData } = await supabase
        .from('companies').select('ppl_agreed_postcodes').eq('id', m.company_id).maybeSingle()
      const merged = [...new Set([...(companyData?.ppl_agreed_postcodes || []), ...listed])]
      await supabase.from('companies').update({ ppl_agreed_postcodes: merged }).eq('id', m.company_id)
    }

    // A repeat pack never touches SMS settings: the company already has the
    // shared number (assigned when it was created) and its AI stays however
    // the client left it. Only a PPL signup switches the AI on.
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 14)
    for (const o of orders) {
      const { error: pplOrderError } = await supabase.from('ppl_orders').insert({
        company_id:  m.company_id,
        total_leads: o.quantity,
        due_date:    dueDate.toISOString().split('T')[0],
        status:      'active',
        notes:       `${m.niche}${m.sub_niche ? ' › ' + m.sub_niche : ''} - ${o.area_city || o.area || m.area_city}`,
      })
      if (pplOrderError) console.error('ppl_orders insert error:', pplOrderError.message)
    }

    const { data: company } = await supabase
      .from('companies').select('name, email, phone').eq('id', m.company_id).maybeSingle()

    // Sync each area to ql-mc as its own order, with the routing postcodes.
    const postcodes = await openAreaPostcodes(m.company_id)
    for (const o of orders) {
      await syncPplOrderToMc({
        companyId:       m.company_id,
        companyName:     company?.name || '',
        contactName:     '',
        email:           company?.email || '',
        phone:           company?.phone || '',
        quantity:        o.quantity,
        pricePerLead:    Number(o.price_per_lead),
        niche:           m.niche,
        subNiche:        m.sub_niche || null,
        areaCity:        o.area_city || o.area || m.area_city,
        locationTypeVal: o.location_type || 'radius',
        radiusKm:        Number(o.radius_km || 50),
        postcodeList:    o.postcode_list || '',
        qlHqOrderId:     o.id,
        postcodes,
      })
    }

    const totalQty = orders.reduce((n, o) => n + o.quantity, 0)
    const totalExGst = orders.reduce((n, o) => n + Number(o.total_amount ?? Number(o.price_per_lead) * o.quantity), 0).toFixed(2)

    await sendInternalEmail(
      `💰 PPL reorder - ${company?.name}`,
      `<h2 style="margin:0 0 16px">${company?.name} purchased a new lead pack.</h2>
       <table style="border-collapse:collapse;font-size:14px">
         <tr><td style="padding:4px 12px 4px 0;color:#666">Company</td><td><strong>${company?.name}</strong></td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td><a href="mailto:${company?.email}">${company?.email}</a></td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Phone</td><td>${company?.phone || '-'}</td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Niche</td><td>${emailNiche(m.niche)}${m.sub_niche ? ' › ' + m.sub_niche : ''}</td></tr>
         ${areaRowsHtml(orders)}
         <tr><td style="padding:4px 12px 4px 0;color:#666">Total leads</td><td><strong>${totalQty}</strong></td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Total (ex GST)</td><td><strong>$${totalExGst} AUD</strong></td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Stripe session</td><td><a href="https://dashboard.stripe.com/payments/${session.payment_intent}">${session.id}</a></td></tr>
       </table>`
    )
    console.log('PPL orders activated:', ids.join(', '))
  } catch (err) {
    console.error('handlePplPayment error:', err)
    await sendInternalEmail(
      `⚠️ PPL payment processing failed - ${ids.length} area order(s)`,
      `<p>Error: ${String(err)}</p><p>Order IDs: ${ids.join(', ')}</p><p>Company ID: ${m.company_id}</p>`
    )
  }
}

// ── PPL signup (new company, first lead pack from website) ──────────────────
async function handlePplSignupPayment(session: Stripe.Checkout.Session, m: Record<string, string>) {
  console.log('PPL signup for:', m.email)
  try {
    // The order, split into priced areas at checkout, waits on the signup
    // attempt for this session (the metadata only has a readable summary).
    // Attempts from before areas were split carry service_areas instead.
    const { data: att } = await supabase
      .from('signup_attempts').select('service_areas, areas')
      .eq('stripe_session_id', session.id).maybeSingle()
    const pricedAreas = Array.isArray(att?.areas) ? att.areas as PplArea[] : []
    let serviceAreas: ServiceArea[] = []
    if (!pricedAreas.length && m.location_type !== 'postcodes' && m.location_type !== 'statewide') {
      if (Array.isArray(att?.service_areas)) serviceAreas = att.service_areas as ServiceArea[]
    }
    const areasSummary = summariseServiceAreas(serviceAreas) || m.service_areas_summary || ''
    // createUser triggers handle_new_user() which auto-creates a company + profile
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: m.email,
      email_confirm: true,
      user_metadata: { full_name: `${m.first_name} ${m.last_name}` },
    })
    if (authError) throw new Error(`Auth: ${authError.message}`)
    const userId = authData.user.id

    const { data: profileData, error: profileFetchError } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', userId)
      .single()
    if (profileFetchError) throw new Error(`Profile fetch: ${profileFetchError.message}`)
    const companyId = profileData.company_id

    const signupPostcodes = m.location_type === 'postcodes' && m.postcode_list
      ? m.postcode_list.split(/[\s,\n]+/).map((p: string) => p.trim()).filter(Boolean)
      : []

    const { error: companyError } = await supabase
      .from('companies')
      .update({
        name:               m.company,
        email:              m.email,
        phone:              m.phone,
        plan:               'ppl',
        status:             'active',
        stripe_customer_id: session.customer as string,
        niche:              m.niche || null,
        ...(signupPostcodes.length > 0 && { ppl_agreed_postcodes: signupPostcodes }),
      })
      .eq('id', companyId)
    if (companyError) throw new Error(`Company: ${companyError.message}`)

    // Bake system_prompt and welcome_message into the SMS agent config row
    // that was created by the DB trigger when the user was provisioned.
    if (m.company && m.niche) {
      const { system_prompt, welcome_message } = buildSmsPrompts(m.company, m.niche)
      const { data: agentCfg } = await supabase
        .from('sms_agent_config')
        .select('id')
        .eq('company_id', companyId)
        .maybeSingle()
      if (agentCfg) {
        await supabase
          .from('sms_agent_config')
          .update({ system_prompt, welcome_message })
          .eq('id', agentCfg.id)
      }
    }

    await supabase.from('profiles').upsert({
      id:         userId,
      company_id: companyId,
      full_name:  `${m.first_name} ${m.last_name}`,
      phone:      m.phone,
      role:       'owner',
      is_active:  true,
    })

    // One order per area (or, for an attempt from before areas were split,
    // the single order it describes).
    const rows = pricedAreas.length
      ? pricedAreas.map((a) => ({
          company_id:     companyId,
          niche:          m.niche,
          sub_niche:      m.sub_niche || null,
          area:           a.city,
          area_city:      a.label,
          location_type:  a.location_type,
          radius_km:      a.radius_km,
          postcode_list:  a.postcode_list,
          ...(a.service_area && { service_areas: [a.service_area] }),
          postcodes:      a.postcodes,
          quantity:       a.quantity,
          price_per_lead: a.price_per_lead,
          total_amount:   a.total_amount,
          status:         'active',
          stripe_session_id:        session.id,
          stripe_payment_intent_id: session.payment_intent as string,
        }))
      : [{
          company_id:     companyId,
          niche:          m.niche,
          sub_niche:      m.sub_niche || null,
          area:           m.area_city,
          area_city:      m.area_city,
          location_type:  m.location_type || 'radius',
          radius_km:      (m.location_type === 'postcodes' || m.location_type === 'statewide') ? null : parseFloat(m.radius_km || '50'),
          postcode_list:  m.location_type === 'postcodes' ? m.postcode_list : null,
          ...(serviceAreas.length && { service_areas: serviceAreas }),
          quantity:       parseInt(m.quantity),
          price_per_lead: parseFloat(m.price_per_lead),
          total_amount:   parseFloat(m.price_per_lead) * parseInt(m.quantity),
          status:         'active',
          stripe_session_id:        session.id,
          stripe_payment_intent_id: session.payment_intent as string,
        }]
    const { data: created, error: orderError } = await supabase
      .from('ppl_lead_orders')
      .insert(rows)
      .select('id, location_type, postcode_list, service_areas, area, area_city, quantity, price_per_lead, total_amount, radius_km')
    if (orderError) throw new Error(`ppl_lead_orders insert: ${orderError.message}`)
    const orders = (created || []) as AreaOrderRow[]

    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 14)
    for (const o of orders) {
      const { error: pplOrderError } = await supabase.from('ppl_orders').insert({
        company_id:  companyId,
        total_leads: o.quantity,
        due_date:    dueDate.toISOString().split('T')[0],
        status:      'active',
        notes:       `${m.niche}${m.sub_niche ? ' › ' + m.sub_niche : ''} - ${o.area_city || o.area || m.area_city}`,
      })
      if (pplOrderError) throw new Error(`ppl_orders insert: ${pplOrderError.message}`)
    }

    await provisionTwilio(companyId)
    if (orders.length) {
      await supabase.from('ppl_lead_orders').update({ twilio_provisioned: true }).in('id', orders.map((o) => o.id))
    }

    // Sync to ql-mc - creates the client as active_client immediately, then
    // one ql-mc order per area.
    const postcodes = await openAreaPostcodes(companyId)
    for (const o of orders) {
      await syncPplOrderToMc({
        companyId:       companyId,
        companyName:     m.company,
        contactName:     `${m.first_name} ${m.last_name}`,
        email:           m.email,
        phone:           m.phone,
        quantity:        o.quantity,
        pricePerLead:    Number(o.price_per_lead),
        niche:           m.niche,
        subNiche:        m.sub_niche || null,
        areaCity:        pricedAreas.length ? (o.area_city || m.area_city) : (areasSummary ? `${m.area_city} - ${areasSummary}` : m.area_city),
        locationTypeVal: o.location_type || 'radius',
        radiusKm:        Number(o.radius_km || 50),
        postcodeList:    o.postcode_list || '',
        qlHqOrderId:     o.id,
        postcodes,
      })
    }

    const magicLink = await createMagicLink(m.email)

    const { error: linkError } = await supabase.from('pending_magic_links').insert({
      stripe_session_id: session.id,
      magic_link:        magicLink,
    })
    if (linkError) console.error('pending_magic_links insert failed:', linkError.message)

    await sendPplWelcomeEmail(m.email, m.first_name, m.company, m.niche, m.area_city, m.quantity, magicLink)

    // ── Full-detail internal notification ─────────────────────────────────────
    const totalExGstNum = orders.reduce((n, o) => n + Number(o.total_amount ?? Number(o.price_per_lead) * o.quantity), 0)
    const totalExGst  = totalExGstNum.toFixed(2)
    const totalIncGst = (totalExGstNum * 1.1).toFixed(2)
    const discountPct = parseFloat(m.discount_percent || '0')
    const locationDetail = m.location_type === 'statewide'
      ? `${m.area_city} - State Wide`
      : m.location_type === 'postcodes'
      ? `Postcodes - ${m.postcode_list || '(none supplied)'}`
      : areasSummary
      ? `${m.area_city} - ${areasSummary}`
      : `${m.area_city} - ${m.radius_km || 50}km radius`

    await sendInternalEmail(
      `💰 New PPL signup - ${m.company}`,
      `<h2 style="margin:0 0 16px">${m.company} signed up and paid for a lead pack.</h2>
       <table style="border-collapse:collapse;font-size:14px">
         <tr><td style="padding:4px 12px 4px 0;color:#666">Company</td><td><strong>${m.company}</strong></td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Name</td><td>${m.first_name} ${m.last_name}</td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td><a href="mailto:${m.email}">${m.email}</a></td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Phone</td><td>${m.phone}</td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Niche</td><td>${emailNiche(m.niche)}${m.sub_niche ? ' › ' + m.sub_niche : ''}</td></tr>
         ${pricedAreas.length ? areaRowsHtml(orders) : `<tr><td style="padding:4px 12px 4px 0;color:#666">Location</td><td>${locationDetail}</td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Price/lead</td><td>$${parseFloat(m.price_per_lead).toFixed(2)} AUD</td></tr>`}
         <tr><td style="padding:4px 12px 4px 0;color:#666">Quantity</td><td><strong>${m.quantity} leads</strong></td></tr>
         ${discountPct > 0 ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Volume discount</td><td>${discountPct}% off</td></tr>` : ''}
         <tr><td style="padding:4px 12px 4px 0;color:#666">Total (ex GST)</td><td><strong>$${totalExGst} AUD</strong></td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Total (inc GST)</td><td>$${totalIncGst} AUD</td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">ql-hq company ID</td><td><code>${companyId}</code></td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#666">Stripe session</td><td><a href="https://dashboard.stripe.com/payments/${session.payment_intent}">${session.id}</a></td></tr>
       </table>`
    )

    await supabase.from('signup_attempts').update({ status: 'completed' })
      .eq('stripe_session_id', session.id)

    console.log('PPL signup provisioned:', companyId)
  } catch (err) {
    console.error('handlePplSignupPayment error:', err)
    await sendInternalEmail(
      `⚠️ PPL signup provisioning failed - ${m.email}`,
      `<p><strong>Email:</strong> ${m.email}</p><p><strong>Stripe Session:</strong> ${session.id}</p><pre>${String(err)}</pre>`
    )
  }
}

// ── Managed / DFY system signup (Branded Lead Gen System, bought on /buy-system) ──
// Paying does NOT create the account: the onboarding form does, as for every
// other client, and the buyer is sent straight to it from the payment page.
// The purchase waits in managed_purchases until the form claims it
// (growth-onboarding calls back in with x-claim-purchase), and is applied to
// the account then. Someone who already has an account (they filled in the
// form first, or were converted in ql-mc) has it applied straight away.
// Pay-per-lead first orders are different: they still get their account here.
type ManagedPurchase = {
  stripe_session_id: string; email: string; metadata: Record<string, string>
  stripe_customer_id: string | null; paid_cents: number | null
}

async function handleManagedSignupPayment(session: Stripe.Checkout.Session, m: Record<string, string>) {
  console.log('Managed/DFY purchase for:', m.email)
  try {
    const purchase: ManagedPurchase = {
      stripe_session_id: session.id,
      email: String(m.email || '').trim().toLowerCase(),
      metadata: m,
      stripe_customer_id: (session.customer as string | null) ?? null,
      // What Stripe actually took, ex GST: after any promo code, before tax.
      paid_cents: typeof session.amount_total === 'number'
        ? session.amount_total - (session.total_details?.amount_tax ?? 0)
        : null,
    }
    const { error: saveErr } = await supabase.from('managed_purchases').upsert(purchase, { onConflict: 'stripe_session_id', ignoreDuplicates: true })
    if (saveErr) throw new Error(`Saving the purchase: ${saveErr.message}`)

    const userId = await findUserIdByEmail(purchase.email)
    if (userId) {
      await applyManagedPurchase(purchase, userId)
      return
    }

    const label = m.plan_label || 'Branded Lead Gen System'
    await sendInternalEmail(
      `💳 System paid - ${m.company || m.email} (${label}), waiting on onboarding`,
      `<p><strong>${m.company || '(no company)'}</strong> just paid for the ${label}. They've been sent to the onboarding form; their account, the Team Panel checklist and the Mission Control client are set up when they submit it.</p>
       <table style="border-collapse:collapse;font-size:14px">
         <tr><td style="padding:3px 14px 3px 0;color:#666">Name</td><td>${[m.first_name, m.last_name].filter(Boolean).join(' ') || m.name || '-'}</td></tr>
         <tr><td style="padding:3px 14px 3px 0;color:#666">Email</td><td>${m.email}</td></tr>
         <tr><td style="padding:3px 14px 3px 0;color:#666">Phone</td><td>${m.phone || '-'}</td></tr>
       </table>
       <p style="margin-top:14px">If they haven't filled it in by tomorrow morning you'll get a reminder.</p>`
    )
  } catch (err) {
    console.error('handleManagedSignupPayment error:', err)
    await sendInternalEmail(
      `⚠️ DFY purchase could not be recorded - ${m.email}`,
      `<p><strong>Email:</strong> ${m.email}</p><p><strong>Stripe Session:</strong> ${session.id}</p><pre>${String(err)}</pre>`
    )
  }
}

// The onboarding form created the buyer's account: apply their paid purchase.
async function claimManagedPurchase(email: string): Promise<{ ok: boolean; claimed: boolean; error?: string }> {
  const want = String(email || '').trim().toLowerCase()
  const { data: row } = await supabase.from('managed_purchases').select('*')
    .eq('email', want).is('claimed_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!row) return { ok: true, claimed: false }
  const userId = await findUserIdByEmail(want)
  if (!userId) return { ok: false, claimed: false, error: 'No account for that email yet' }
  try {
    await applyManagedPurchase(row as ManagedPurchase, userId)
    return { ok: true, claimed: true }
  } catch (e) {
    return { ok: false, claimed: false, error: (e as Error).message }
  }
}

// Put a paid system purchase on the buyer's account: the plan and what they
// told checkout, "Paid & signed", the Mission Control client, and the team told.
async function applyManagedPurchase(p: ManagedPurchase, userId: string) {
  const m = p.metadata || {}
  const firstName = m.first_name || (m.name ? m.name.trim().split(/\s+/)[0] : '') || 'there'
  const lastName  = m.last_name  || (m.name ? m.name.trim().split(/\s+/).slice(1).join(' ') : '')

  const { data: profileData, error: profileFetchError } = await supabase
    .from('profiles').select('company_id').eq('id', userId).single()
  if (profileFetchError) throw new Error(`Profile fetch: ${profileFetchError.message}`)
  const companyId = profileData.company_id

  // What they told /buy-system before paying. The service area goes on the
  // company; the rest is kept under dfy_profile.purchase so the team (and the
  // onboarding form, which keeps this key) can see it instead of asking again.
  const { data: prior } = await supabase
    .from('companies').select('dfy_profile, service_area').eq('id', companyId).maybeSingle()
  const purchaseAnswers = {
    plan:              m.plan || null,
    service_location:  m.service_location || null,
    monthly_lead_goal: m.monthly_lead_goal || null,
    multi_campaign:    m.multi_campaign || null,
    google_too:        m.google_too || null,
    source:            m.source || null,
    stripe_session:    p.stripe_session_id,
  }

  const { error: companyError } = await supabase
    .from('companies')
    .update({
      name:               m.company || `${firstName}'s Company`,
      email:              m.email,
      phone:              m.phone || null,
      plan:               'managed',
      status:             'active',
      // A payment-mode session only carries a customer when one was created;
      // never overwrite a customer we already hold with null.
      ...(p.stripe_customer_id && { stripe_customer_id: p.stripe_customer_id }),
      niche:              m.niche || null,
      ...(m.service_location && !prior?.service_area && { service_area: m.service_location }),
      dfy_profile:        { ...((prior?.dfy_profile as Record<string, unknown>) || {}), purchase: purchaseAnswers },
      // The monthly fee agreed with the build, for when they switch on
      // ongoing management. The standard build leaves it unset so it follows
      // the list price in create-management-subscription.
      ...(m.plan && m.plan !== 'standard' && Number(m.management_fee) > 0
        && { management_fee_cents: Math.round(Number(m.management_fee) * 100) }),
    })
    .eq('id', companyId)
  if (companyError) throw new Error(`Company: ${companyError.message}`)

  await supabase.from('profiles').upsert({
    id:         userId,
    company_id: companyId,
    full_name:  `${firstName} ${lastName}`.trim(),
    phone:      m.phone || null,
    role:       'owner',
    is_active:  true,
  })

  // The Team Panel checklist starts from what this purchase already did:
  // paying is the spam gate. The account and the welcome email are the
  // onboarding form's, so they are ticked there.
  // What Stripe actually took, ex GST: after any promo code, before tax. The
  // list price in metadata is kept for the notes so a discount is visible.
  const listFee  = Number(m.amount_charged) || 0
  const paidCents = typeof p.paid_cents === 'number' ? p.paid_cents : null
  const buildFee = paidCents !== null ? Math.max(0, paidCents) / 100 : listFee
  const discounted = buildFee < listFee
  const feeText  = `$${buildFee.toLocaleString('en-AU')} + GST` +
    (discounted ? ` (list $${listFee.toLocaleString('en-AU')}, discount applied)` : '')
  const monthly  = Number(m.management_fee) || 0
  const label    = m.plan_label || 'Branded Lead Gen System'
  await markFulfilment(companyId, [
    ['paid_signed',     `Paid online: ${label}, ${feeText}`],
    ['signup_verified', buildFee > 0 ? 'Paid by card' : 'Checkout completed with a 100% discount'],
  ])

  // Mission Control: the lead to Closed Won, a managed client in Onboarding
  // and the build fee logged, then the checklist summary on that client.
  const mcSync = await syncManagedPurchaseToMc({
    ql_hq_company_id: companyId,
    name:             `${firstName} ${lastName}`.trim(),
    company_name:     m.company || '',
    email:            m.email,
    phone:            m.phone || '',
    niche:            m.niche || m.trade || '',
    tier_label:       label,
    build_fee:        buildFee,
    management_fee:   monthly,
    goal:             m.monthly_lead_goal || '',
  })

  // Notify ops that a DFY system was purchased.
  await sendInternalEmail(
    `🚀 New system purchase - ${m.company || m.email} (${label})`,
    `${mcSync.ok ? '' : `<p style="color:#b42318"><strong>Mission Control was NOT updated:</strong> ${mcSync.error}. Add the client there by hand.</p>`}
     <p><strong>${m.company || '(no company)'}</strong> just bought the ${label}: ${feeText}, then $${monthly.toLocaleString('en-AU')}/mo + GST if they keep management after the first 30 days.</p>
     <table style="border-collapse:collapse;font-size:14px">
       <tr><td style="padding:3px 14px 3px 0;color:#666">Name</td><td>${firstName} ${lastName}</td></tr>
       <tr><td style="padding:3px 14px 3px 0;color:#666">Company</td><td>${m.company || '-'}</td></tr>
       <tr><td style="padding:3px 14px 3px 0;color:#666">Email</td><td>${m.email}</td></tr>
       <tr><td style="padding:3px 14px 3px 0;color:#666">Phone</td><td>${m.phone || '-'}</td></tr>
       <tr><td style="padding:3px 14px 3px 0;color:#666">Trade</td><td>${emailNiche(m.niche) || m.trade || '-'}</td></tr>
       <tr><td style="padding:3px 14px 3px 0;color:#666">Lead goal</td><td>${m.monthly_lead_goal || '-'}</td></tr>
       <tr><td style="padding:3px 14px 3px 0;color:#666">Service area</td><td>${m.service_location || '-'}</td></tr>
     </table>
     <p style="margin-top:14px">Their account is set up as <strong>managed</strong> and they're in Mission Control. Time to build their system.</p>`
  )
  await supabase.from('managed_purchases').update({ company_id: companyId, claimed_at: new Date().toISOString() })
    .eq('stripe_session_id', p.stripe_session_id)
  console.log('Managed/DFY purchase applied:', companyId)
}

// An existing auth user's id by email, for a buyer who already has an account.
async function findUserIdByEmail(email: string): Promise<string | null> {
  const want = email.trim().toLowerCase()
  for (let page = 1; page <= 10; page++) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    const hit = (data?.users || []).find((u) => (u.email || '').toLowerCase() === want)
    if (hit) return hit.id
    if (!data?.users?.length || data.users.length < 1000) break
  }
  return null
}

// Mark checklist steps done, the way growth-onboarding's setStep does: the
// step row plus a log line, attributed to Automation. A step already settled
// is left as it is.
async function markFulfilment(companyId: string, steps: Array<[string, string | null]>) {
  for (const [stepKey, notes] of steps) {
    const { data: prev } = await supabase
      .from('company_fulfilment').select('status')
      .eq('company_id', companyId).eq('step_key', stepKey).maybeSingle()
    if (prev?.status === 'done' || prev?.status === 'skipped') continue
    const { error } = await supabase.from('company_fulfilment').upsert({
      company_id: companyId, step_key: stepKey, status: 'done',
      notes: notes ? notes.slice(0, 2000) : null, completed_by_name: 'Automation',
    }, { onConflict: 'company_id,step_key' })
    if (error) { console.warn('markFulfilment failed:', stepKey, error.message); continue }
    await supabase.from('fulfilment_log').insert({
      company_id: companyId, actor_name: 'Automation', action: 'fulfilment.step_set',
      step_key: stepKey, from_status: prev?.status ?? 'pending', to_status: 'done',
      detail: notes ? { notes: notes.slice(0, 500) } : {},
    })
  }
}

// Record an online system purchase in ql-mc, then push the checklist summary
// onto the client it creates. Best effort, like syncPplOrderToMc: the account
// is already provisioned, and a failure here is in the logs and the ops email.
async function syncManagedPurchaseToMc(purchase: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  if (!QL_MC_API_URL || !QL_MC_API_SECRET) {
    console.warn('QL_MC_API_URL or QL_MC_API_SECRET not configured - skipping ql-mc sync')
    return { ok: false, error: 'the ql-mc link is not configured' }
  }
  const post = (body: Record<string, unknown>) => fetch(`${QL_MC_API_URL}/sync-from-hq`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-secret': QL_MC_API_SECRET },
    body: JSON.stringify(body),
  })
  try {
    const res = await post({ action: 'upsert_managed_purchase', ...purchase })
    if (!res.ok) {
      const text = await res.text()
      console.error(`ql-mc upsert_managed_purchase returned ${res.status}: ${text}`)
      return { ok: false, error: `ql-mc answered ${res.status}: ${text.slice(0, 300)}` }
    }
    const { data: sum } = await supabase
      .from('company_fulfilment_summary')
      .select('stage, stage_at, active_status, steps_done, steps_settled, steps_total, blocked_count, next_step_key, next_step_due')
      .eq('company_id', purchase.ql_hq_company_id).maybeSingle()
    if (sum) await post({ action: 'upsert_fulfilment', hq_company_id: purchase.ql_hq_company_id, summary: sum })
    return { ok: true }
  } catch (err) {
    console.error('syncManagedPurchaseToMc HTTP error:', err)
    return { ok: false, error: String(err) }
  }
}

// ── Management subscription (monthly) ──────────────────────────────────────
// Fires on create, on every renewal that changes status, on card failure, and
// on cancellation from the billing portal. Stripe holds the truth; we mirror
// just enough onto the company to render the dashboard without calling the
// Stripe API on page load.
async function handleManagementSubscriptionChange(
  sub: Stripe.Subscription,
  eventType: string
) {
  // Only ours. Other subscriptions on the same Stripe account are ignored.
  if (sub.metadata?.type !== 'management') return

  const companyId = sub.metadata?.company_id
  if (!companyId) {
    console.error('management subscription with no company_id:', sub.id)
    return
  }

  try {
    // A deleted subscription is over regardless of the status Stripe last set.
    const status = eventType === 'customer.subscription.deleted' ? 'canceled' : sub.status

    const { data: prior } = await supabase
      .from('companies')
      .select('name, email, management_status')
      .eq('id', companyId)
      .maybeSingle()

    const { error } = await supabase
      .from('companies')
      .update({
        management_status:          status,
        management_subscription_id: sub.id,
        management_period_end:      sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
        management_cancel_at_end:   Boolean(sub.cancel_at_period_end),
      })
      .eq('id', companyId)
    if (error) throw new Error(`Company update: ${error.message}`)

    // Tell ops when the money starts, stops, or fails - not on every renewal.
    const was = prior?.management_status ?? null
    const who = prior?.name || prior?.email || companyId
    const endsOn = sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toLocaleDateString('en-AU')
      : 'unknown'
    // The client's actual monthly fee (ex GST), read from the subscription so
    // it is right for per-client prices and after any list-price change.
    const cents = sub.items?.data?.[0]?.price?.unit_amount
    const fee = typeof cents === 'number'
      ? `$${(cents / 100).toLocaleString('en-AU', { maximumFractionDigits: 2 })}/mo + GST`
      : 'their monthly fee'

    if (status === 'trialing' && was !== 'trialing') {
      await sendInternalEmail(
        `💰 Management booked - ${who}`,
        `<p><strong>${who}</strong> switched on ongoing management at ${fee}. Their included period runs until ${endsOn}, when the first payment is taken.</p>`
      )
    } else if (status === 'active' && was !== 'active') {
      await sendInternalEmail(
        `💰 Management subscription started - ${who}`,
        `<p><strong>${who}</strong> just switched on ongoing management at ${fee}.</p>
         <p>Next billing date: ${endsOn}</p>`
      )
    } else if (status === 'past_due' && was !== 'past_due') {
      await sendInternalEmail(
        `⚠️ Management payment failed - ${who}`,
        `<p><strong>${who}</strong>'s ${fee} management payment failed. Stripe will retry, but their card likely needs updating.</p>`
      )
    } else if (status === 'canceled' && was !== 'canceled') {
      await sendInternalEmail(
        `🔻 Management cancelled - ${who}`,
        `<p><strong>${who}</strong> cancelled ongoing management. Their campaigns should stop being managed after ${endsOn}.</p>`
      )
    } else if (sub.cancel_at_period_end && status === 'active') {
      await sendInternalEmail(
        `🔻 Management set to cancel - ${who}`,
        `<p><strong>${who}</strong> has set management to end on ${endsOn}. Still active until then.</p>`
      )
    }

    console.log('Management subscription', status, 'for company', companyId)
  } catch (err) {
    console.error('handleManagementSubscriptionChange error:', err)
    await sendInternalEmail(
      `⚠️ Management subscription sync failed - company ${companyId}`,
      `<p><strong>Subscription:</strong> ${sub.id}</p><p><strong>Event:</strong> ${eventType}</p><pre>${String(err)}</pre>`
    )
  }
}

// ── SMS credits top-up (existing dashboard company) ────────────────────────
async function handleSmsCreditsTopUp(session: Stripe.Checkout.Session, m: Record<string, string>) {
  console.log('SMS credits top-up for company:', m.company_id, 'credits:', m.credits)
  try {
    const credits = parseInt(m.credits)
    if (!credits || credits <= 0) throw new Error('Invalid credits value')

    const { error: creditErr } = await supabase.rpc('add_sms_credits', { p_company_id: m.company_id, p_amount: credits })
    if (creditErr) throw new Error(`add_sms_credits: ${creditErr.message}`)

    const { data: company } = await supabase
      .from('companies').select('name, email').eq('id', m.company_id).maybeSingle()

    await sendInternalEmail(
      `📱 SMS credits top-up - ${company?.name}`,
      `<p>${company?.name} purchased ${credits} SMS credits.</p><p><strong>Email:</strong> ${company?.email}</p>`
    )
    console.log('SMS credits added:', credits, 'to', m.company_id)
  } catch (err) {
    console.error('handleSmsCreditsTopUp error:', err)
    await sendInternalEmail(
      `⚠️ SMS credits top-up failed - company ${m.company_id}`,
      `<p>Error: ${String(err)}</p><p>Credits: ${m.credits}</p><p>Stripe Session: ${session.id}</p>`
    )
  }
}

// ── Emails ───────────────────────────────────────────────────────────────────

async function sendPplWelcomeEmail(
  to: string, firstName: string, company: string,
  niche: string, city: string, quantity: string, magicLink: string
) {
  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'QuoteLeads <onboarding@quoteleads.com.au>',
      to,
      subject: `You're in, ${firstName}. Your leads are on their way.`,
      html: `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f5f5f5;margin:0;padding:40px 20px">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5">
          <div style="background:#0a0b0f;padding:28px 36px">
            <img src="https://quoteleads.com.au/quoteleads-logo-white.png" alt="QuoteLeads" style="height:30px">
          </div>
          <div style="padding:36px">
            <h1 style="font-size:22px;font-weight:600;color:#0a0b0f;margin:0 0 8px">Your leads are on their way, ${firstName}.</h1>
            <p style="color:#666;font-size:15px;line-height:1.6;margin:0 0 28px">
              Your ${company} workspace is live. Your ${quantity} ${pplNicheDisplay(niche, niche === 'hvac' ? 'split_ducted' : null)} leads (${city}) should start arriving within 24-48 hours. It can occasionally take a little longer, as every lead is generated in real time and we wait on genuine demand in your area.
            </p>
            <a href="${magicLink}" style="display:inline-block;background:#4797FF;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:500;margin-bottom:32px">
              Access My Dashboard →
            </a>
            <div style="background:#f8f9fb;border-radius:8px;padding:18px;margin-bottom:24px">
              <p style="font-size:13px;font-weight:600;color:#0a0b0f;margin:0 0 10px">What's ready:</p>
              <ul style="font-size:13px;color:#555;line-height:1.9;margin:0;padding-left:18px">
                <li>CRM and pipeline</li>
                <li>Order tracking and delivery status</li>
                <li>Quote templates</li>
              </ul>
            </div>
            <p style="font-size:12px;color:#999;margin:24px 0 0;line-height:1.6">
              Questions? Reply to this email or reach us on WhatsApp.<br>
              This login link expires in 24 hours.
            </p>
          </div>
        </div>
      </body></html>`,
    }),
  })
  if (!emailRes.ok) {
    const errBody = await emailRes.text()
    throw new Error(`Resend error ${emailRes.status}: ${errBody}`)
  }
}

// Internal ops emails show solar_and_battery (older orders say solar_battery)
function emailNiche(niche: string | null | undefined): string {
  return niche === 'solar_battery' ? 'solar_and_battery' : (niche || '')
}

async function sendInternalEmail(subject: string, body: string) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'QuoteLeads System <system@quoteleads.com.au>',
      to:   'contact@quoteleads.com.au',
      subject,
      html: `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#333;line-height:1.7">${body}</div>`,
    }),
  }).catch(err => console.error('sendInternalEmail error:', err))
}
