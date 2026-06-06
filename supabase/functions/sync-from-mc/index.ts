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

  // Validate shared secret (same secret used on ql-mc → ql-hq direction)
  const apiSecret = Deno.env.get('QL_MC_API_SECRET')
  const provided  = req.headers.get('x-api-secret')
  if (!apiSecret || !provided || provided !== apiSecret) {
    return json({ error: 'unauthorized' }, 401)
  }

  try {
    const body = await req.json()
    const { ql_hq_company_id, email, sms_number, webhook_url, postcodes } = body

    if (!ql_hq_company_id || typeof ql_hq_company_id !== 'string' || !ql_hq_company_id.trim()) {
      return json({ error: 'ql_hq_company_id is required' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Read current settings so we can merge rather than overwrite other keys
    const { data: company, error: readErr } = await supabase
      .from('companies')
      .select('settings')
      .eq('id', ql_hq_company_id.trim())
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
      .eq('id', ql_hq_company_id.trim())

    if (updateErr) throw updateErr

    return json({ ok: true })
  } catch (err) {
    console.error('sync-from-mc error:', err)
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500)
  }
})
