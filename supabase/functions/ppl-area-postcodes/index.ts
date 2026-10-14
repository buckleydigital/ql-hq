// ppl-area-postcodes - the postcodes each pay-per-lead company still has room in.
//
// Orders are split into areas, each with its own postcodes and its own number
// of leads (migration 20261014000001). ql-mc routes leads by a client's
// postcodes, so its ppl-area-refresh asks here every few minutes and stops
// sending leads into an area once it is full. Companies with an older,
// unsplit order still running are not listed, so the postcodes set by hand in
// ql-mc for them stay as they are.
//
// ql-mc calls it with the same x-api-secret it uses for sync-from-mc.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const secret = Deno.env.get('QL_MC_API_SECRET')
  if (!secret || req.headers.get('x-api-secret') !== secret) return json({ error: 'unauthorized' }, 401)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await db.rpc('ppl_open_area_postcodes')
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true, companies: data || [] })
})
