// Public endpoint — returns PPL price for a given niche + area (no auth required).
// GET ?niche=solar&area=sydney  → { price_per_lead, min_quantity, max_quantity }
// GET ?niche=solar              → default price for that niche (no area match)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const niche = url.searchParams.get('niche')?.toLowerCase().trim()
  const area  = url.searchParams.get('area')?.toLowerCase().trim()

  if (!niche) {
    return new Response(
      JSON.stringify({ error: 'niche is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Try area-specific price first, fall back to niche default
  let pricing = null

  if (area) {
    const { data } = await supabase
      .from('ppl_pricing')
      .select('price_per_lead, min_quantity, max_quantity')
      .eq('niche', niche)
      .eq('area', area)
      .maybeSingle()
    pricing = data
  }

  if (!pricing) {
    const { data } = await supabase
      .from('ppl_pricing')
      .select('price_per_lead, min_quantity, max_quantity')
      .eq('niche', niche)
      .is('area', null)
      .maybeSingle()
    pricing = data
  }

  if (!pricing) {
    return new Response(
      JSON.stringify({ error: `No pricing found for niche: ${niche}` }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify(pricing),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
