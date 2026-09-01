import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Normalise an AU number to E.164 (+61…) so bulk-SMS recipients match the way
// leads are stored here (twilio-inbound writes E.164 too).
function normalisePhone(raw: string): string | null {
  let p = (raw || '').replace(/[\s\-().]/g, '')
  if (p.startsWith('0') && p.length === 10) p = '+61' + p.slice(1)
  else if (p.startsWith('614') && p.length === 11) p = '+' + p
  else if (p.startsWith('61') && !p.startsWith('+') && p.length === 11) p = '+' + p
  return p || null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/

// The setup email a new client gets, matching what create-user-silent sends
// when an admin creates an account by hand. Kept deliberately plain: the
// account exists, here is how to get into it.
async function sendSetupEmail(to: string, name: string, setupLink: string | null): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) { console.warn('RESEND_API_KEY missing - no setup email sent'); return false }
  const cta = setupLink
    ? `<p style="margin:0 0 18px"><a href="${setupLink}" style="display:inline-block;background:#1f6fff;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600">Set your password &rarr;</a></p>
       <p style="margin:0 0 18px;font-size:12px;color:#9ca3af">This link expires in 1 hour. If it does, use "Forgot password" at quoteleadshq.com/dashboard.</p>`
    : `<p style="margin:0 0 18px">Go to <a href="https://quoteleadshq.com/dashboard" style="color:#1f6fff">quoteleadshq.com/dashboard</a> and use "Forgot password" to choose your password.</p>`
  const text = setupLink
    ? `Hi ${name || 'there'},\n\nYour QuoteLeads account is ready. Set your password (expires in 1 hour):\n${setupLink}\n\nIf it expires, use "Forgot password" at https://quoteleadshq.com/dashboard\n\nQuoteLeads`
    : `Hi ${name || 'there'},\n\nYour QuoteLeads account is ready. Go to https://quoteleadshq.com/dashboard and use "Forgot password" to choose your password.\n\nQuoteLeads`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'QuoteLeads <system@quoteleads.com.au>',
      to,
      subject: 'Your QuoteLeads account is ready',
      html: `<html><body style="margin:0;padding:0;background:#f3f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:32px 24px;background:#fff;font-size:15px;line-height:1.65;color:#1a1a20">
<p style="margin:0 0 18px">Hi ${name || 'there'},</p>
<p style="margin:0 0 18px">Your QuoteLeads account is ready. Set a password and you are in.</p>
${cta}
<p style="margin:0;color:#6b7280;font-size:13px">QuoteLeads</p>
</div></body></html>`,
      text,
    }),
  })
  if (!res.ok) { console.error('setup email failed:', res.status, await res.text()); return false }
  return true
}

// action: disable_ai — a bulk SMS was sent from ql-mc to these leads. Turn the
// AI SMS agent OFF for each of them on the agency (super-admin) company so it
// never auto-replies to their responses. Leads that don't exist in ql-hq yet
// are created up-front with ai_enabled=false, otherwise twilio-inbound would
// create them with ai_enabled=true on their first reply and the AI would fire.
// deno-lint-ignore no-explicit-any
async function handleDisableAi(supabase: any, body: any) {
  // Accept either [{phone,name}] objects or bare phone strings.
  const rawLeads: Array<{ phone?: string; name?: string } | string> =
    Array.isArray(body.leads) ? body.leads
    : Array.isArray(body.phones) ? body.phones
    : body.phone ? [body.phone] : []

  // Map normalised E.164 phone -> best-known name (first non-empty wins).
  const byPhone = new Map<string, string>()
  for (const item of rawLeads) {
    const rawPhone = typeof item === 'string' ? item : item?.phone
    const name = typeof item === 'string' ? '' : (item?.name || '')
    const norm = normalisePhone(rawPhone || '')
    if (!norm) continue
    if (!byPhone.has(norm) || (!byPhone.get(norm) && name)) byPhone.set(norm, (name || '').trim())
  }
  const phones = [...byPhone.keys()]
  if (!phones.length) return json({ error: 'leads (with phone) is required' }, 400)

  // The agency's leads live under the one super-admin company (the tenant tied
  // to a profiles.is_admin=true user) — the only place the AI SMS agent runs.
  const { data: adminProfile } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('is_admin', true)
    .not('company_id', 'is', null)
    .limit(1)
    .maybeSingle()
  const superId = adminProfile?.company_id
  if (!superId) return json({ error: 'super-admin company not found' }, 404)

  // Older leads may store the phone without the + or in AU local format, so
  // match every plausible variant when disabling AI on existing rows.
  const candidates = new Set<string>()
  for (const p of phones) {
    candidates.add(p)
    candidates.add(p.replace(/^\+/, ''))
    if (p.startsWith('+61')) candidates.add('0' + p.slice(3))
  }

  const { data: updated, error: updErr } = await supabase
    .from('leads')
    .update({ ai_enabled: false, updated_at: new Date().toISOString() })
    .eq('company_id', superId)
    .in('phone', [...candidates])
    .select('phone')
  if (updErr) throw updErr

  const matched = new Set<string>()
  for (const row of updated || []) {
    const n = normalisePhone(row.phone as string)
    if (n) matched.add(n)
  }

  const toCreate = phones.filter((p) => !matched.has(p))
  let created = 0
  if (toCreate.length) {
    const rows = toCreate.map((p) => {
      const full = (byPhone.get(p) || '').trim()
      const first = full ? full.split(/\s+/)[0] : 'SMS Lead'
      return {
        company_id: superId,
        first_name: first,
        name: full || 'SMS Lead',
        phone: p,
        source: 'bulk_sms',
        pipeline_stage: 'new_lead',
        ai_enabled: false,
        ai_score: 0,
        ai_score_reason: 'AI disabled - contacted via bulk SMS',
      }
    })
    const { error: insErr } = await supabase.from('leads').insert(rows)
    if (insErr) throw insErr
    created = rows.length
  }

  return json({ ok: true, disabled: (updated || []).length, created })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const apiSecret = Deno.env.get('QL_MC_API_SECRET')
  const provided  = req.headers.get('x-api-secret')
  if (!apiSecret || !provided || provided !== apiSecret) {
    return json({ error: 'unauthorized' }, 401)
  }

  try {
    const body = await req.json()
    const { action, ql_hq_company_id, email, sms_number, webhook_url, postcodes } = body

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── action: create_client_account ───────────────────────────────────────
    // A lead was converted in ql-mc. Create the ql-hq account so the client can
    // log in, and hand back the company id so ql-mc can offer to assign a VA in
    // the same breath. Idempotent: an existing user for that email returns its
    // company rather than erroring or creating a second one.
    if (action === 'create_client_account') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const name  = String(body.name ?? '').trim()
      if (!email || !EMAIL_RE.test(email)) return json({ error: 'A valid email is required' }, 400)

      const company_name = String(body.company_name ?? '').trim()
      const phone        = String(body.phone ?? '').trim()
      const niche        = String(body.niche ?? '').trim()
      const service_area = String(body.service_area ?? '').trim()
      const plan         = body.plan === 'ppl' ? 'ppl' : 'managed'

      // Already here? Return what exists instead of creating a duplicate.
      let userId: string | null = null
      let existing = false
      let page = 1
      while (page <= 10 && !userId) {
        const { data: list } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
        const hit = (list?.users || []).find((u) => (u.email || '').toLowerCase() === email)
        if (hit) { userId = hit.id; existing = true; break }
        if (!list?.users?.length || list.users.length < 1000) break
        page++
      }

      if (!userId) {
        const { data: created, error: cErr } = await supabase.auth.admin.createUser({
          email, email_confirm: true, user_metadata: { full_name: name },
        })
        if (cErr || !created?.user) return json({ error: cErr?.message || 'Could not create the account' }, 500)
        userId = created.user.id
      }

      // handle_new_user() creates the profile + company synchronously, but poll
      // briefly rather than assume - the same wait create-user-silent does.
      let companyId: string | null = null
      for (let attempt = 0; attempt < 8 && !companyId; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 200))
        const { data: prof } = await supabase
          .from('profiles').select('company_id').eq('id', userId).maybeSingle()
        if (prof?.company_id) companyId = prof.company_id as string
      }

      if (companyId) {
        const patch: Record<string, unknown> = { plan }
        if (company_name) patch.name = company_name
        if (phone) patch.phone = phone
        if (email) patch.email = email
        if (niche) patch.niche = niche
        if (service_area) patch.service_area = service_area
        const { error: upErr } = await supabase.from('companies').update(patch).eq('id', companyId)
        if (upErr) console.warn('company patch failed (non-fatal):', upErr.message)
      }

      // Only a genuinely new account gets the setup email; re-running the
      // conversion on an existing client must not spam them a second time.
      let emailSent = false
      if (!existing) {
        let setupLink: string | null = null
        try {
          const { data: link } = await supabase.auth.admin.generateLink({
            type: 'recovery', email,
            options: { redirectTo: 'https://quoteleadshq.com/dashboard' },
          })
          setupLink = link?.properties?.action_link ?? null
        } catch (e) {
          console.warn('setup link failed (non-fatal):', (e as Error).message)
        }
        emailSent = await sendSetupEmail(email, name, setupLink)
      }

      return json({ ok: true, user_id: userId, company_id: companyId, existing, email_sent: emailSent })
    }

    // ── action: list_vas ────────────────────────────────────────────────────
    // So ql-mc can show a VA picker without holding any ql-hq credentials.
    if (action === 'list_vas') {
      const { data: vas } = await supabase
        .from('profiles').select('id, full_name').eq('is_va', true)
      const { data: assigns } = await supabase.from('va_assignments').select('va_user_id')
      const counts: Record<string, number> = {}
      for (const a of assigns || []) counts[a.va_user_id as string] = (counts[a.va_user_id as string] || 0) + 1
      return json({
        vas: (vas || []).map((v: Record<string, unknown>) => ({
          id: v.id, name: v.full_name || '', assigned: counts[v.id as string] || 0,
        })),
      })
    }

    // ── action: assign_va ───────────────────────────────────────────────────
    // Mirrors va-api's assign, including the "you have a new client" email, so
    // assigning from ql-mc behaves exactly like assigning from /admin.
    if (action === 'assign_va') {
      const vaId = String(body.va_user_id ?? '').trim()
      const companyId = String(body.company_id ?? '').trim()
      if (!vaId || !companyId) return json({ error: 'va_user_id and company_id are required' }, 400)

      const { data: target } = await supabase
        .from('profiles').select('is_va, full_name').eq('id', vaId).maybeSingle()
      if (!target?.is_va) return json({ error: 'That user is not a VA' }, 400)

      const { data: already } = await supabase.from('va_assignments')
        .select('id').eq('va_user_id', vaId).eq('company_id', companyId).maybeSingle()
      const { error: aErr } = await supabase.from('va_assignments')
        .upsert({ va_user_id: vaId, company_id: companyId }, { onConflict: 'va_user_id,company_id' })
      if (aErr) return json({ error: aErr.message }, 500)

      let notified = false
      if (!already) {
        const { data: u } = await supabase.auth.admin.getUserById(vaId)
        const vaEmail = u?.user?.email || ''
        const { data: company } = await supabase
          .from('companies').select('name, plan, niche, service_area').eq('id', companyId).maybeSingle()
        if (vaEmail) {
          const vaFirst = String(target.full_name || '').trim().split(/\s+/)[0] || 'there'
          const text = [
            `Hi ${vaFirst},`, '',
            `${company?.name || 'A new client'} has been assigned to you.`, '',
            'Two things to do, in this order:', '',
            '  1. Log in to your dashboard and check the scope is right - plan, niche and service area. If anything looks wrong, flag it before you contact them.',
            '  2. Send them the onboarding email from the client\'s page. The draft is ready, edit it if you want, and it goes out with your address on the reply.',
            '', 'Details on file:',
            `  Plan: ${company?.plan || '-'}`,
            `  Niche: ${company?.niche || '-'}`,
            `  Service area: ${company?.service_area || '-'}`,
            '', 'https://quoteleadshq.com/va', '', 'QuoteLeads',
          ].join('\n')
          const apiKey = Deno.env.get('RESEND_API_KEY')
          if (apiKey) {
            const res = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: 'QuoteLeads <system@quoteleads.com.au>',
                to: vaEmail,
                subject: `New client assigned - ${company?.name || 'action needed'}`,
                text,
              }),
            })
            notified = res.ok
            if (!res.ok) console.warn('VA notification failed:', await res.text())
          }
        }
      }
      return json({ ok: true, notified })
    }

    // ── action: disable_ai ──────────────────────────────────────────────────
    // Resolves the super-admin company server-side, so no ql_hq_company_id.
    if (action === 'disable_ai') {
      return await handleDisableAi(supabase, body)
    }

    if (!ql_hq_company_id || typeof ql_hq_company_id !== 'string' || !ql_hq_company_id.trim()) {
      return json({ error: 'ql_hq_company_id is required' }, 400)
    }

    const companyId = ql_hq_company_id.trim()

    // ── action: scrub ─────────────────────────────────────────────────────────
    // A lead was scrubbed in ql-mc - pull the delivered count back by one on the
    // most relevant order. We mirror this onto BOTH order tables independently:
    //   • ppl_orders.delivered_leads      (admin fulfillment tracker)
    //   • ppl_lead_orders.delivered_count (client dashboard order)
    // Each is guarded: if that table has no matching row for the company, it's
    // skipped silently so nothing breaks. Prefer the oldest active order, fall
    // back to the most recently completed/fulfilled one (in case the scrub tips
    // it back under the threshold and should reopen).
    if (action === 'scrub') {
      // ── ppl_orders (admin) ──────────────────────────────────────────────────
      let { data: order } = await supabase
        .from('ppl_orders')
        .select('id, delivered_leads, total_leads, status')
        .eq('company_id', companyId)
        .eq('status', 'active')
        .order('purchased_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!order) {
        const { data: completed } = await supabase
          .from('ppl_orders')
          .select('id, delivered_leads, total_leads, status')
          .eq('company_id', companyId)
          .eq('status', 'completed')
          .order('purchased_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        order = completed
      }

      let delivered_leads: number | null = null
      if (order) {
        const newDelivered = Math.max(0, order.delivered_leads - 1)
        // If we're pulling back below total, reopen a completed order
        const newStatus = order.status === 'completed' && newDelivered < order.total_leads
          ? 'active'
          : order.status
        await supabase
          .from('ppl_orders')
          .update({ delivered_leads: newDelivered, status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', order.id)
        delivered_leads = newDelivered
      }

      // ── ppl_lead_orders (client dashboard) - independent + guarded ──────────
      let { data: leadOrder } = await supabase
        .from('ppl_lead_orders')
        .select('id, delivered_count, quantity, status')
        .eq('company_id', companyId)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!leadOrder) {
        const { data: fulfilled } = await supabase
          .from('ppl_lead_orders')
          .select('id, delivered_count, quantity, status')
          .eq('company_id', companyId)
          .eq('status', 'fulfilled')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        leadOrder = fulfilled
      }

      let delivered_count: number | null = null
      if (leadOrder) {
        const newCount = Math.max(0, leadOrder.delivered_count - 1)
        // If we're pulling back below quantity, reopen a fulfilled order
        const newStatus = leadOrder.status === 'fulfilled' && newCount < leadOrder.quantity
          ? 'active'
          : leadOrder.status
        await supabase
          .from('ppl_lead_orders')
          .update({ delivered_count: newCount, status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', leadOrder.id)
        delivered_count = newCount
      }

      // ── flag the exact lead as scrubbed (blocks any future dispute) ─────────
      // Matched by phone + name + company, all exact (phone E.164-normalised,
      // name trimmed case-insensitive). Most recent un-flagged match wins.
      let lead_flagged: string | null = null
      const leadIdent = (body as { lead?: { name?: string | null; phone?: string | null } }).lead
      if (leadIdent?.phone && leadIdent?.name) {
        const wantPhone = normalisePhone(leadIdent.phone)
        const wantName  = leadIdent.name.trim().toLowerCase()
        const { data: hqLeads } = await supabase
          .from('leads')
          .select('id, name, phone, ppl_scrubbed')
          .eq('company_id', companyId)
          .eq('is_ppl', true)
          .eq('ppl_scrubbed', false)
          .order('created_at', { ascending: false })
          .limit(200)
        const hqMatch = (hqLeads || []).find((l: { name?: string | null; phone?: string | null }) =>
          normalisePhone((l.phone as string) || '') === wantPhone &&
          ((l.name as string) || '').trim().toLowerCase() === wantName,
        )
        if (hqMatch) {
          await supabase
            .from('leads')
            .update({ ppl_scrubbed: true, updated_at: new Date().toISOString() })
            .eq('id', (hqMatch as { id: string }).id)
          lead_flagged = (hqMatch as { id: string }).id
        }
      }

      return json({ ok: true, delivered_leads, delivered_count, lead_flagged })
    }

    // ── default action: sync delivery config + postcodes ─────────────────────
    const { data: company, error: readErr } = await supabase
      .from('companies')
      .select('settings')
      .eq('id', companyId)
      .maybeSingle()

    if (readErr) throw readErr
    if (!company) return json({ error: 'company not found' }, 404)

    const updates: Record<string, unknown> = {
      settings: {
        ...(company.settings || {}),
        lead_delivery: {
          email:       email       ?? null,
          sms_number:  sms_number  ?? null,
          webhook_url: webhook_url ?? null,
        },
      },
    }

    if (Array.isArray(postcodes)) {
      updates.ppl_agreed_postcodes = (postcodes as unknown[])
        .map((p) => String(p).trim().toUpperCase())
        .filter(Boolean)
    }

    const { error: updateErr } = await supabase
      .from('companies')
      .update(updates)
      .eq('id', companyId)

    if (updateErr) throw updateErr

    return json({ ok: true })
  } catch (err) {
    console.error('sync-from-mc error:', err)
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500)
  }
})
