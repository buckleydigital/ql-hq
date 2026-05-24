// Public endpoint — returns PPL price for a given niche + area (no auth required).
// GET ?niche=solar&area=Brisbane  → { price_per_lead }
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

  // Fetch all rows for this niche, match area in JS to avoid case/encoding issues
  const { data: rows, error } = await supabase
    .from('ppl_pricing')
    .select('price_per_lead, area')
    .eq('niche', niche)

  if (error) {
    console.error('ppl_pricing query error:', JSON.stringify(error))
    return new Response(
      JSON.stringify({ error: 'DB error', detail: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!rows || rows.length === 0) {
    return new Response(
      JSON.stringify({ error: `No pricing found for niche: ${niche}`, rows_checked: 0 }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Area-specific match (case-insensitive JS comparison)
  let pricing = area
    ? rows.find(r => r.area?.toLowerCase().trim() === area) ?? null
    : null

  // Fall back to default (null area)
  if (!pricing) {
    pricing = rows.find(r => !r.area) ?? null
  }

  if (!pricing) {
    return new Response(
      JSON.stringify({ error: `No pricing for area: ${area}`, available: rows.map(r => r.area) }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Fetch active volume discount tiers ordered by sort_order
  const { data: tiers } = await supabase
    .from('volume_discount_tiers')
    .select('min_quantity, discount_percent, label, is_popular')
    .eq('active', true)
    .order('sort_order')

  return new Response(
    JSON.stringify({
      price_per_lead: pricing.price_per_lead,
      discount_tiers: tiers || [],
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
