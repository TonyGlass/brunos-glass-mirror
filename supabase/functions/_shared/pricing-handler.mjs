import { normalizePricingConfig, normalizeProject, publicEstimate } from './pricing-contract.mjs';

// Repository/auth injection permits testing without changing Supabase.
export function createPricingHandler({read, save, requireAdmin, allowedOrigins}) {
  return async request => {
    const origin = request.headers.get('origin') || '';
    const headers = {'Content-Type':'application/json', 'Cache-Control':'no-store',
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods':'POST, OPTIONS', 'Vary':'Origin'};
    if (allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (body, status=200) => new Response(JSON.stringify(body), {status,headers});
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (request.method !== 'POST') return reply({error:'Method not allowed'},405);
    try {
      const text = await request.text();
      if (text.length > 100000) return reply({error:'Request too large'},413);
      let body;
      try {body=JSON.parse(text);} catch {return reply({error:'Invalid JSON'},400);}
      if (!body || typeof body !== 'object') return reply({error:'Invalid request'},400);
      if (body.action === 'estimate') {
        let project;
        try {project=normalizeProject(body.project);} catch(error) {return reply({error:error.message},400);}
        return reply({estimate:publicEstimate(project,await read())});
      }
      if (!['read','save'].includes(body.action)) return reply({error:'Unknown action'},400);
      const user = await requireAdmin(request);
      if (!user) return reply({error:'Administrator access required'},403);
      if (body.action === 'read') return reply({pricing:await read()});
      if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) return reply({error:'Invalid revision'},400);
      let config;
      try {config=normalizePricingConfig(body.config);} catch(error) {return reply({error:error.message},400);}
      const saved = await save(config,body.expectedRevision,user.id);
      if (!saved) return reply({error:'Pricing changed on another device. Reload central pricing before saving.'},409);
      return reply({pricing:saved});
    } catch {
      return reply({error:'Central pricing is unavailable. No pricing changes were saved.'},503);
    }
  };
}
