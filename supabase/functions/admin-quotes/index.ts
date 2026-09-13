import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'https://brunos-glass-mirror.fittony85.workers.dev'
]);
const BUCKET = 'quote-photos';
const ALLOWED_STATUSES = new Set([
  'New',
  'Reviewing',
  'Quoted',
  'Approved',
  'Completed',
  'Lost'
]);
const QUOTE_COLUMNS = [
  'id',
  'created_at',
  'name',
  'phone',
  'email',
  'service',
  'message',
  'city',
  'product',
  'door_type',
  'glass_type',
  'hardware_finish',
  'handle_style',
  'quantity',
  'width',
  'height',
  'square_feet',
  'status',
  'estimated_price',
  'final_price',
  'estimated_price_low',
  'estimated_price_high',
  'photo_paths'
].join(',');

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function corsFor(origin: string) {
  const headers = new Headers(corsHeaders);
  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return headers;
}

function response(body: Record<string, unknown>, status: number, origin: string) {
  const headers = corsFor(origin);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

function getSecretClient() {
  const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!);
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    secretKeys.default
  );
}

async function requireAdmin(request: Request) {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new Error('Authentication required.');
  }

  const supabaseAdmin = getSecretClient();
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    throw new Error('Invalid authentication token.');
  }

  const allowedEmails = (Deno.env.get('ADMIN_EMAILS') || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const hasAdminRole = data.user.app_metadata?.role === 'admin';
  const isAllowedEmail = Boolean(data.user.email && allowedEmails.includes(data.user.email.toLowerCase()));

  if (!hasAdminRole && !isAllowedEmail) {
    throw new Error('Administrator access required.');
  }

  return supabaseAdmin;
}

async function listQuotes(supabaseAdmin: ReturnType<typeof getSecretClient>) {
  const { data, error } = await supabaseAdmin
    .from('quotes')
    .select(QUOTE_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

async function getQuote(supabaseAdmin: ReturnType<typeof getSecretClient>, id: string) {
  const { data: quote, error } = await supabaseAdmin
    .from('quotes')
    .select(QUOTE_COLUMNS)
    .eq('id', id)
    .single();

  if (error) {
    throw error;
  }

  const photoPaths = Array.isArray(quote.photo_paths) ? quote.photo_paths : [];
  const photos = [];
  for (const path of photoPaths) {
    const { data, error: signedUrlError } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60);

    if (!signedUrlError && data?.signedUrl) {
      photos.push({ path, signedUrl: data.signedUrl });
    }
  }

  return { ...quote, photos };
}

async function updateQuote(
  supabaseAdmin: ReturnType<typeof getSecretClient>,
  body: { id: string; status?: string; final_price?: number | null }
) {
  if (!body.id) {
    throw new Error('Quote id is required.');
  }

  const updates: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.has(body.status)) {
      throw new Error('Invalid quote status.');
    }
    updates.status = body.status;
  }

  if (body.final_price !== undefined) {
    if (body.final_price !== null && (!Number.isFinite(body.final_price) || body.final_price < 0)) {
      throw new Error('Final price must be a non-negative number.');
    }
    updates.final_price = body.final_price;
  }

  if (!Object.keys(updates).length) {
    throw new Error('No quote changes provided.');
  }

  const { data, error } = await supabaseAdmin
    .from('quotes')
    .update(updates)
    .eq('id', body.id)
    .select(QUOTE_COLUMNS)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsFor(origin) });
  }

  if (request.method !== 'POST') {
    return response({ error: 'Method not allowed.' }, 405, origin);
  }

  try {
    const body = await request.json();
    const supabaseAdmin = await requireAdmin(request);

    if (body.action === 'list') {
      return response({ quotes: await listQuotes(supabaseAdmin) }, 200, origin);
    }

    if (body.action === 'get') {
      return response({ quote: await getQuote(supabaseAdmin, body.id) }, 200, origin);
    }

    if (body.action === 'update') {
      return response({ quote: await updateQuote(supabaseAdmin, body) }, 200, origin);
    }

    return response({ error: 'Unknown action.' }, 400, origin);
  } catch (error) {
    console.error('admin-quotes error:', error);
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    const status = message.includes('Authentication') || message.includes('Administrator') || message.includes('Invalid authentication') ? 401 : 400;
    return response({ error: message }, status, origin);
  }
});
