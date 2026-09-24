// Supabase Edge Function: the Elitists War game server. The game engine is bundled into game.js
// by tools/build-server.mjs and loaded from this repository at a pinned commit (see deploy step).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle, SupabaseStore } from './game.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const body = await req.json();
    // Deadline sweeps can run without a signed-in player; everything else needs one.
    let userId = '';
    if (body.op !== 'tick') {
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data, error } = await service.auth.getUser(token);
      if (error || !data.user) return json({ error: 'Please sign in again.' }, 401);
      userId = data.user.id;
    }
    return json(await handle(new SupabaseStore(service), userId, body));
  } catch (e) {
    const msg = (e as Error).message ?? 'Something went wrong.';
    return json({ error: msg }, msg.startsWith('Someone else moved first') ? 409 : 400);
  }
});
