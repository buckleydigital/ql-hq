import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY')!, { apiVersion: '2024-04-10' })
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)
const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY')!
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

serve(async (req) => {
  const sig  = req.headers.get('stripe-signature')!
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature failed:', err)
    return new Response('Unauthorized', { status: 401 })
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response('OK', { status: 200 })
  }

  const session = event.data.object as Stripe.Checkout.Session
  const m = session.metadata || {}

  switch (m.type) {
    case 'ppl':
      await handlePplPayment(session, m)
      break
    case 'ppl_signup':
      await handlePplSignupPayment(session, m)
      break
    case 'advertising_system':
      await handleAdvertisingSystemPayment(session, m)
      break
    case 'advertising_system_upgrade':
      await handleAdvertisingSystemUpgrade(session, m)
      break
    default:
      await handleManagedPayment(session, m)
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

async function hasTwilioNumber(companyId: string): Promise<boolean> {
  const { data } = await supabase
    .from('twilio_numbers')
    .select('id')
    .eq('company_id', companyId)
    .maybeSingle()
  return !!data
}

async function createMagicLink(email: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: 'https://quoteleadshq.com/dashboard', expiresIn: 86400 },
  })
  if (error) throw new Error(`Magic link: ${error.message}`)
  return data.properties.action_link
}

function buildSystemPrompt(m: Record<string, string>): string {
  return `You are a friendly and professional sales assistant for ${m.company}, a ${m.industry} business based in ${m.service_location}.

Your job is to qualify inbound leads via SMS. Keep messages short, warm and conversational — never more than 2-3 sentences.

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

Always be helpful, never pushy. Sign off as the ${m.company} team.`
}

async function insertSmsAgentConfig(companyId: string, m: Record<string, string>) {
  await supabase.from('sms_agent_config').insert({
    company_id:               companyId,
    model:                    'gpt-4o',
    is_active:                false,
    auto_reply:               false,
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

// ── PPL payment (existing company buying more leads) ───────────────────────────
async function handlePplPayment(session: Stripe.Checkout.Session, m: Record<string, string>) {
  console.log('PPL payment for order:', m.order_id)
  try {
    await supabase
      .from('ppl_lead_orders')
      .update({ status: 'active', stripe_payment_intent_id: session.payment_intent as string })
      .eq('id', m.order_id)

    if (!await hasTwilioNumber(m.company_id)) {
      await provisionTwilio(m.company_id)
      await supabase.from('ppl_lead_orders').update({ twilio_provisioned: true }).eq('id', m.order_id)
    }

    const { data: company } = await supabase
      .from('companies').select('name, email, phone').eq('id', m.company_id).maybeSingle()

    await sendInternalEmail(
      `💰 New PPL order — ${company?.name}`,
      `<h2>${company?.name} purchased a lead pack.</h2>
       <p><strong>Niche:</strong> ${m.niche}</p>
       <p><strong>Area:</strong> ${m.area_city}</p>
       <p><strong>Quantity:</strong> ${m.quantity} leads</p>
       <p><strong>Total:</strong> $${(parseFloat(m.price_per_lead) * parseInt(m.quantity)).toFixed(2)} AUD</p>
       <p><strong>Email:</strong> ${company?.email}</p>
       <p><strong>Phone:</strong> ${company?.phone || '—'}</p>`
    )
    console.log('PPL order activated:', m.order_id)
  } catch (err) {
    console.error('handlePplPayment error:', err)
    await sendInternalEmail(
      `⚠️ PPL payment processing failed — order ${m.order_id}`,
      `<p>Error: ${String(err)}</p><p>Order ID: ${m.order_id}</p><p>Company ID: ${m.company_id}</p>`
    )
  }
}

// ── PPL signup (new company buying first lead pack from website) ───────────────
async function handlePplSignupPayment(session: Stripe.Checkout.Session, m: Record<string, string>) {
  console.log('PPL signup for:', m.email)
  try {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: m.email,
      email_confirm: true,
      user_metadata: { full_name: `${m.first_name} ${m.last_name}` },
    })
    if (authError) throw new Error(`Auth: ${authError.message}`)
    const userId = authData.user.id

    const { data: company, error: companyError } = await supabase
      .from('companies')
      .insert({
        name:               m.company,
        email:              m.email,
        phone:              m.phone,
        plan:               'ppl',
        status:             'active',
        has_advertising_system: false,
        stripe_customer_id: session.customer as string,
        settings:           { onboarding_complete: false },
      })
      .select('id')
      .single()
    if (companyError) throw new Error(`Company: ${companyError.message}`)
    const companyId = company.id

    await supabase.from('profiles').upsert({
      id:         userId,
      company_id: companyId,
      full_name:  `${m.first_name} ${m.last_name}`,
      phone:      m.phone,
      role:       'owner',
      is_active:  true,
    })

    // Create the lead order (already paid)
    const { data: order } = await supabase
      .from('ppl_lead_orders')
      .insert({
        company_id:     companyId,
        niche:          m.niche,
        area:           m.area_city,
        area_city:      m.area_city,
        location_type:  m.location_type || 'radius',
        radius_km:      m.location_type !== 'postcodes' ? parseFloat(m.radius_km || '50') : null,
        postcode_list:  m.location_type === 'postcodes' ? m.postcode_list : null,
        quantity:       parseInt(m.quantity),
        price_per_lead: parseFloat(m.price_per_lead),
        total_amount:   parseFloat(m.price_per_lead) * parseInt(m.quantity),
        status:         'active',
        stripe_payment_intent_id: session.payment_intent as string,
      })
      .select('id')
      .single()

    await provisionTwilio(companyId)
    if (order) {
      await supabase.from('ppl_lead_orders').update({ twilio_provisioned: true }).eq('id', order.id)
    }

    const magicLink = await createMagicLink(m.email)
    await sendPplWelcomeEmail(m.email, m.first_name, m.company, m.niche, m.area_city, m.quantity, magicLink)

    await sendInternalEmail(
      `💰 New PPL signup — ${m.company}`,
      `<h2>${m.company} signed up and purchased a lead pack.</h2>
       <p><strong>Name:</strong> ${m.first_name} ${m.last_name}</p>
       <p><strong>Email:</strong> ${m.email}</p>
       <p><strong>Phone:</strong> ${m.phone}</p>
       <p><strong>Niche:</strong> ${m.niche}</p>
       <p><strong>Area:</strong> ${m.area_city}</p>
       <p><strong>Quantity:</strong> ${m.quantity} leads</p>`
    )
    console.log('PPL signup provisioned:', companyId)
  } catch (err) {
    console.error('handlePplSignupPayment error:', err)
    await sendInternalEmail(
      `⚠️ PPL signup provisioning failed — ${m.email}`,
      `<p><strong>Email:</strong> ${m.email}</p><p><strong>Stripe Session:</strong> ${session.id}</p><pre>${String(err)}</pre>`
    )
  }
}

// ── Advertising system signup (new company from website) ──────────────────────
async function handleAdvertisingSystemPayment(session: Stripe.Checkout.Session, m: Record<string, string>) {
  console.log('Advertising system signup for:', m.email)
  try {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: m.email,
      email_confirm: true,
      user_metadata: { full_name: `${m.first_name} ${m.last_name}` },
    })
    if (authError) throw new Error(`Auth: ${authError.message}`)
    const userId = authData.user.id

    const { data: company, error: companyError } = await supabase
      .from('companies')
      .insert({
        name:                        m.company,
        email:                       m.email,
        phone:                       m.phone,
        plan:                        'ppl',
        status:                      'active',
        has_advertising_system:      true,
        advertising_system_purchased_at: new Date().toISOString(),
        stripe_customer_id:          session.customer as string,
        settings: {
          industry:           m.industry,
          service_location:   m.service_location,
          service_radius:     m.service_radius,
          onboarding_complete: false,
          onboarding:         m,
        },
      })
      .select('id')
      .single()
    if (companyError) throw new Error(`Company: ${companyError.message}`)
    const companyId = company.id

    await supabase.from('profiles').upsert({
      id:         userId,
      company_id: companyId,
      full_name:  `${m.first_name} ${m.last_name}`,
      phone:      m.phone,
      role:       'owner',
      is_active:  true,
    })

    await insertSmsAgentConfig(companyId, m)
    await provisionTwilio(companyId)

    const magicLink = await createMagicLink(m.email)
    await sendAdvertisingWelcomeEmail(m.email, m.first_name, m.company, magicLink)

    await sendInternalEmail(
      `🚀 New advertising system client — ${m.company}`,
      `<h2>${m.company} purchased the advertising system.</h2>
       <p><strong>Name:</strong> ${m.first_name} ${m.last_name}</p>
       <p><strong>Email:</strong> ${m.email}</p>
       <p><strong>Phone:</strong> ${m.phone}</p>
       <p><strong>Industry:</strong> ${m.industry}</p>
       <p><strong>Location:</strong> ${m.service_location} (${m.service_radius})</p>`
    )
    console.log('Advertising system client provisioned:', companyId)
  } catch (err) {
    console.error('handleAdvertisingSystemPayment error:', err)
    await sendInternalEmail(
      `⚠️ Advertising system provisioning failed — ${m.email}`,
      `<p><strong>Email:</strong> ${m.email}</p><p><strong>Stripe Session:</strong> ${session.id}</p><pre>${String(err)}</pre>`
    )
  }
}

// ── Advertising system upgrade (existing dashboard company) ───────────────────
async function handleAdvertisingSystemUpgrade(session: Stripe.Checkout.Session, m: Record<string, string>) {
  console.log('Advertising system upgrade for company:', m.company_id)
  try {
    await supabase
      .from('companies')
      .update({
        has_advertising_system:          true,
        advertising_system_purchased_at: new Date().toISOString(),
      })
      .eq('id', m.company_id)

    if (!await hasTwilioNumber(m.company_id)) {
      await provisionTwilio(m.company_id)
    }

    // Create SMS agent config if it doesn't exist yet
    const { data: existing } = await supabase
      .from('sms_agent_config')
      .select('id')
      .eq('company_id', m.company_id)
      .maybeSingle()

    if (!existing) {
      const { data: co } = await supabase
        .from('companies')
        .select('name, settings')
        .eq('id', m.company_id)
        .maybeSingle()

      const fakeMeta: Record<string, string> = {
        company:          co?.name || '',
        industry:         co?.settings?.industry || '',
        service_location: co?.settings?.service_location || '',
        service_radius:   co?.settings?.service_radius || '',
        special_offers:   '',
        products_brands:  '',
      }
      await insertSmsAgentConfig(m.company_id, fakeMeta)
    }

    const { data: company } = await supabase
      .from('companies').select('name, email').eq('id', m.company_id).maybeSingle()

    await sendInternalEmail(
      `⬆️ Advertising system upgrade — ${company?.name}`,
      `<h2>${company?.name} upgraded to the advertising system.</h2>
       <p><strong>Email:</strong> ${company?.email}</p>
       <p><strong>Stripe Session:</strong> ${session.id}</p>`
    )
    console.log('Advertising system upgrade complete:', m.company_id)
  } catch (err) {
    console.error('handleAdvertisingSystemUpgrade error:', err)
    await sendInternalEmail(
      `⚠️ Advertising system upgrade failed — company ${m.company_id}`,
      `<p>Error: ${String(err)}</p><p>Stripe Session: ${session.id}</p>`
    )
  }
}

// ── Managed payment (legacy full-service onboarding) ──────────────────────────
async function handleManagedPayment(session: Stripe.Checkout.Session, m: Record<string, string>) {
  console.log('Managed payment for:', m.email)
  try {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: m.email,
      email_confirm: true,
      user_metadata: { full_name: `${m.first_name} ${m.last_name}` },
    })
    if (authError) throw new Error(`Auth: ${authError.message}`)
    const userId = authData.user.id

    const { data: company, error: companyError } = await supabase
      .from('companies')
      .insert({
        name:               m.company,
        email:              m.email,
        phone:              m.phone,
        plan:               'managed',
        status:             'active',
        has_advertising_system: true,
        advertising_system_purchased_at: new Date().toISOString(),
        stripe_customer_id: session.customer as string,
        settings: {
          industry:           m.industry,
          service_location:   m.service_location,
          service_radius:     m.service_radius,
          onboarding_complete: false,
          onboarding:         m,
        },
      })
      .select('id')
      .single()
    if (companyError) throw new Error(`Company: ${companyError.message}`)
    const companyId = company.id

    await supabase.from('profiles').upsert({
      id:         userId,
      company_id: companyId,
      full_name:  `${m.first_name} ${m.last_name}`,
      phone:      m.phone,
      role:       'owner',
      is_active:  true,
    })

    await insertSmsAgentConfig(companyId, m)

    const magicLink = await createMagicLink(m.email)
    await sendAdvertisingWelcomeEmail(m.email, m.first_name, m.company, magicLink)

    await sendInternalEmail(
      `🚀 New managed client — ${m.company}`,
      `<h2>${m.company} has paid and is onboarding.</h2>
       <p><strong>Name:</strong> ${m.first_name} ${m.last_name}</p>
       <p><strong>Email:</strong> ${m.email}</p>
       <p><strong>Phone:</strong> ${m.phone}</p>
       <p><strong>Industry:</strong> ${m.industry}</p>
       <p><strong>Location:</strong> ${m.service_location} (${m.service_radius})</p>
       <p><strong>Ad spend:</strong> ${m.max_daily_spend}</p>`
    )
    console.log('Managed client provisioned:', companyId)
  } catch (err) {
    console.error('handleManagedPayment error:', err)
    await sendInternalEmail(
      `⚠️ Managed provisioning failed — ${m.email}`,
      `<p><strong>Email:</strong> ${m.email}</p><p><strong>Stripe Session:</strong> ${session.id}</p><pre>${String(err)}</pre>`
    )
  }
}

// ── Emails ─────────────────────────────────────────────────────────────────────

async function sendPplWelcomeEmail(
  to: string, firstName: string, company: string,
  niche: string, city: string, quantity: string, magicLink: string
) {
  await fetch('https://api.resend.com/emails', {
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
              Your ${company} workspace is live and your first batch of ${quantity} ${niche} leads for ${city} will start arriving within 7–14 days.
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
}

async function sendAdvertisingWelcomeEmail(
  to: string, firstName: string, company: string, magicLink: string
) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'QuoteLeads <onboarding@quoteleads.com.au>',
      to,
      subject: `You're in, ${firstName}. Your advertising system is ready.`,
      html: `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f5f5f5;margin:0;padding:40px 20px">
        <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5">
          <div style="background:#0a0b0f;padding:28px 36px">
            <img src="https://quoteleads.com.au/quoteleads-logo-white.png" alt="QuoteLeads" style="height:30px">
          </div>
          <div style="padding:36px">
            <h1 style="font-size:22px;font-weight:600;color:#0a0b0f;margin:0 0 8px">Your advertising system is live, ${firstName}.</h1>
            <p style="color:#666;font-size:15px;line-height:1.6;margin:0 0 28px">
              Your ${company} workspace is ready. Click below to access your dashboard — no password needed.
            </p>
            <a href="${magicLink}" style="display:inline-block;background:#4797FF;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:500;margin-bottom:32px">
              Access My Dashboard →
            </a>
            <div style="background:#f8f9fb;border-radius:8px;padding:18px;margin-bottom:24px">
              <p style="font-size:13px;font-weight:600;color:#0a0b0f;margin:0 0 10px">What's unlocked:</p>
              <ul style="font-size:13px;color:#555;line-height:1.9;margin:0;padding-left:18px">
                <li>CRM and pipeline</li>
                <li>AI SMS agent — pre-configured for ${company}</li>
                <li>Dedicated Twilio phone number</li>
                <li>Meta / Google ad campaign management</li>
                <li>Landing pages and lead capture forms</li>
                <li>Quote templates and follow-up automation</li>
              </ul>
            </div>
            <div style="border-top:1px solid #eee;padding-top:24px">
              <p style="font-size:13px;color:#333;margin:0 0 12px">
                <strong>Next:</strong> Connect your Meta Business account inside the dashboard to launch your first campaign.
              </p>
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
