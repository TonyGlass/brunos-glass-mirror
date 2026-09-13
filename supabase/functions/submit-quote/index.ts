import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'null',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const BUCKET = 'quote-photos';
const MAX_FILES = 5;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const TOKEN_TTL_SECONDS = 15 * 60;
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime'
]);
const QUOTE_FIELDS = [
  'name',
  'phone',
  'email',
  'city',
  'service',
  'product',
  'door_type',
  'glass_type',
  'hardware_finish',
  'handle_style',
  'quantity',
  'width',
  'height',
  'square_feet',
  'message',
  'estimated_price',
  'estimated_price_low',
  'estimated_price_high',
  'final_price',
  'status'
];

const SUPABASE_SECRET_KEYS = JSON.parse(
  Deno.env.get('SUPABASE_SECRET_KEYS')!
);

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  SUPABASE_SECRET_KEYS['default']
);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function encodeBase64Url(value: string) {
  return btoa(value)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function decodeBase64Url(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  return atob(padded);
}

async function signToken(payload: Record<string, unknown>) {
  const secret = Deno.env.get('QUOTE_UPLOAD_TOKEN_SECRET');
  if (!secret) {
    throw new Error('QUOTE_UPLOAD_TOKEN_SECRET is not configured.');
  }

  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(encodedPayload)
  );

  return `${encodedPayload}.${encodeBase64Url(String.fromCharCode(...new Uint8Array(signature)))}`;
}

async function verifyToken(token: string) {
  const secret = Deno.env.get('QUOTE_UPLOAD_TOKEN_SECRET');
  if (!secret) {
    throw new Error('QUOTE_UPLOAD_TOKEN_SECRET is not configured.');
  }

  const [encodedPayload, encodedSignature] = token.split('.');
  if (!encodedPayload || !encodedSignature) {
    throw new Error('Invalid upload token.');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signature = Uint8Array.from(decodeBase64Url(encodedSignature), (character) => character.charCodeAt(0));
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    new TextEncoder().encode(encodedPayload)
  );

  if (!valid) {
    throw new Error('Invalid upload token.');
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload));
  if (typeof payload.expiresAt !== 'number' || payload.expiresAt < Date.now()) {
    throw new Error('Upload token expired.');
  }

  return payload as { quoteId: string; paths: string[]; expiresAt: number };
}

function sanitizeFileName(name: string) {
  const extension = name.split('.').pop()?.toLowerCase() || 'bin';
  return `${crypto.randomUUID()}.${extension.replace(/[^a-z0-9]/g, '')}`;
}

async function createQuote(body: { quote: Record<string, unknown>; files: Array<{ name: string; size: number; type: string }> }) {
  const files = body.files || [];

  if (files.length > MAX_FILES) {
    return jsonResponse({ error: 'A maximum of 5 files is allowed.' }, 400);
  }

  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type) || file.size > MAX_FILE_SIZE || file.size < 1) {
      return jsonResponse({ error: 'Each file must be an allowed type and no larger than 50 MB.' }, 400);
    }
  }

  const quoteData = Object.fromEntries(
    QUOTE_FIELDS
      .filter((field) => Object.hasOwn(body.quote || {}, field))
      .map((field) => [field, body.quote[field]])
  );

  const { data: quote, error: quoteError } = await supabaseAdmin
    .from('quotes')
    .insert([{ ...quoteData, photo_paths: [] }])
    .select('id')
    .single();

  if (quoteError) {
    throw quoteError;
  }

  const paths = files.map((file) => `quotes/${quote.id}/${sanitizeFileName(file.name)}`);
  const uploads = [];

  for (const path of paths) {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);

    if (error) {
      throw error;
    }

    uploads.push({ path, token: data.token });
  }

  const finalizeToken = await signToken({
    quoteId: quote.id,
    paths,
    expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000
  });

  return jsonResponse({ uploads, finalizeToken });
}

async function finalizeQuote(finalizeToken: string) {
  const payload = await verifyToken(finalizeToken);

  if (payload.paths.length === 0) {
    const { error: emptyUpdateError } = await supabaseAdmin
      .from('quotes')
      .update({ photo_paths: [] })
      .eq('id', payload.quoteId);

    if (emptyUpdateError) {
      throw emptyUpdateError;
    }

    return jsonResponse({ success: true });
  }

  const folder = `quotes/${payload.quoteId}`;
  const { data: objects, error: listError } = await supabaseAdmin.storage
    .from(BUCKET)
    .list(folder);

  if (listError) {
    throw listError;
  }

  const uploadedNames = new Set((objects || []).map((object) => object.name));
  const allFilesUploaded = payload.paths.every((path) => uploadedNames.has(path.slice(folder.length + 1)));

  if (!allFilesUploaded) {
    return jsonResponse({ error: 'Not all files were uploaded.' }, 400);
  }

  const { error: updateError } = await supabaseAdmin
    .from('quotes')
    .update({ photo_paths: payload.paths })
    .eq('id', payload.quoteId);

  if (updateError) {
    throw updateError;
  }

  return jsonResponse({ success: true });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  try {
    const body = await request.json();

    if (body.action === 'create') {
      return await createQuote(body);
    }

    if (body.action === 'finalize') {
      return await finalizeQuote(body.finalizeToken);
    }

    return jsonResponse({ error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('submit-quote error:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected server error.' }, 500);
  }
});