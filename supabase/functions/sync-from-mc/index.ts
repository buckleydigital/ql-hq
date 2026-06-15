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

    if (!ql_hq_company_id || typeof ql_hq_company_id !== 'string' || !ql_hq_company_id.trim()) {
      return json({ error: 'ql_hq_company_id is required' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const companyId = ql_hq_company_id.trim()

    // ── action: scrub ─────────────────────────────────────────────────────────
    // A lead was scrubbed in ql-mc — pull the delivered count back by one on the
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

      // ── ppl_lead_orders (client dashboard) — independent + guarded ──────────
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

      return json({ ok: true, delivered_leads, delivered_count })
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
