import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPricingHandler } from '../_shared/pricing-handler.mjs';

// Preflight must not depend on credentials, database availability, or client startup.
let client: ReturnType<typeof createClient> | undefined;
function getClient() {
  if (!client) {
    let serviceKey='';
    const secretKeysText=Deno.env.get('SUPABASE_SECRET_KEYS');
    if(secretKeysText){try{serviceKey=JSON.parse(secretKeysText).default||'';}catch{}}
    serviceKey ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if(!serviceKey)throw new Error('Supabase service key is not configured.');
    client = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  }
  return client;
}
const columns = 'config,revision,updated_at,updated_by';
const allowedOrigins = new Set(['http://localhost:8000','http://127.0.0.1:8000',
  'http://localhost:8765','http://127.0.0.1:8765',
  'https://brunos-glass-mirror.english-academy-fl.workers.dev',
  'https://brunos-glass-mirror-staging.english-academy-fl.workers.dev',
  ...(Deno.env.get('ADDITIONAL_ALLOWED_ORIGINS') || '').split(',').map(origin=>origin.trim()).filter(Boolean)]);

Deno.serve(createPricingHandler({
  allowedOrigins,
  async requireAdmin(request: Request) {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i,'');
    if (!token) return null;
    const {data,error} = await getClient().auth.getUser(token);
    if (error || !data.user) return null;
    const allowedEmails = (Deno.env.get('ADMIN_EMAILS') || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
    return data.user.app_metadata?.role === 'admin' || allowedEmails.includes((data.user.email || '').toLowerCase()) ? data.user : null;
  },
  async read() {
    const {data,error} = await getClient().from('quote_pricing_config').select(columns).eq('id',1).maybeSingle();
    if (error) throw error;
    return data;
  },
  async save(config: object, revision: number, userId: string) {
    const client = getClient();
    const row = {config,revision:revision+1,updated_at:new Date().toISOString(),updated_by:userId};
    const query = revision === 0
      ? client.from('quote_pricing_config').insert({id:1,...row})
      : client.from('quote_pricing_config').update(row).eq('id',1).eq('revision',revision);
    const {data,error} = await query.select(columns).maybeSingle();
    if (error?.code === '23505') return null;
    if (error) throw error;
    return data;
  }
}));
