import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const QL_MC_API_URL    = Deno.env.get('QL_MC_API_URL')!       // e.g. https://api.ql-mc.com
const QL_MC_API_SECRET = Deno.env.get('QL_MC_API_SECRET')!    // shared secret

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Verify caller is authenticated
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response('Unauthorized', { status: 401 })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return new Response('Unauthorized', { status: 401 })

    // Load company + current settings
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.company_id) return new Response('Company not found', { status: 404 })

    const { data: company } = await supabase
      .from('companies')
      .select('id, name, settings')
      .eq('id', profile.company_id)
      .maybeSingle()

    if (!company) return new Response('Company not found', { status: 404 })

    const delivery = company.settings?.lead_delivery || {}

    // Push to ql-mc
    const res = await fetch(`${QL_MC_API_URL}/delivery-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': QL_MC_API_SECRET,
      },
      body: JSON.stringify({
        ql_hq_company_id: company.id,
        company_name:     company.name,
        email:            delivery.email      || null,
        sms_number:       delivery.sms_number || null,
        webhook_url:      delivery.webhook_url || null,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`ql-mc returned ${res.status}: ${text}`)
    }

    return new Response(JSON.stringify({ synced: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('sync-delivery-config error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
