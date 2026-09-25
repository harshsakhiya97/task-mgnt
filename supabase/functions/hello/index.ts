// Supabase Edge Function: runs on Supabase's servers, NOT on cPanel.
// Deploy with:  supabase functions deploy hello
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let name = 'world'
  try {
    const body = await req.json()
    if (body?.name) name = String(body.name)
  } catch { /* no body */ }

  return new Response(
    JSON.stringify({ message: `Hello ${name} from Supabase Edge Functions`, time: new Date().toISOString() }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
