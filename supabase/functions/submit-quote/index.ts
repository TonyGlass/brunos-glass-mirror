import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { normalizeProject, publicEstimate, quoteEstimateFields } from '../_shared/pricing-contract.mjs';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
  'https://brunos-glass-mirror.english-academy-fl.workers.dev',
  ...(Deno.env.get('ADDITIONAL_ALLOWED_ORIGINS') || '').split(',').map(origin=>origin.trim()).filter(Boolean)
]);

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function getCorsHeaders(origin: string) {
  const headers = new Headers(corsHeaders);

  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }

  return headers;
}

function withCors(response: Response, origin: string) {
  const headers = new Headers(response.headers);
  const allowedHeaders = getCorsHeaders(origin);

  allowedHeaders.forEach((value, key) => headers.set(key, value));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

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
  'installation_address',
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

function getServiceKey() {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try { const key=JSON.parse(secretKeys).default; if(typeof key==='string'&&key)return key; }
    catch { /* Use the platform-provided service key below. */ }
  }
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!key)throw new Error('Supabase service key is not configured.');
  return key;
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  getServiceKey()
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

async function createQuote(body: { quote: Record<string, unknown>; pricing?: {revision?:number; counts?:Record<string,number>; enduroShield?:boolean; mirrorFrame?:boolean; customQuote?:boolean}; files: Array<{ name: string; size: number; type: string }> }) {
  if (!Deno.env.get('QUOTE_UPLOAD_TOKEN_SECRET')) return jsonResponse({error:'Quote submission is temporarily unavailable.'},503);
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

  // Recompute automatic estimates using trusted central configuration; custom requests are stored without invented prices.
  if (body.pricing?.customQuote === true) {
    if (!quoteData.product || typeof quoteData.product !== 'string') return jsonResponse({error:'Select the custom service requested.'},400);
    Object.assign(quoteData,{estimated_price:null,estimated_price_low:null,estimated_price_high:null,final_price:null,status:'New'});
  } else {
    const project = normalizeProject({service:quoteData.service, glassType:quoteData.glass_type,
      width:quoteData.width, height:quoteData.height, quantity:quoteData.quantity, counts:body.pricing?.counts, enduroShield:body.pricing?.enduroShield, mirrorFrame:body.pricing?.mirrorFrame});
    const {data:pricing,error:pricingError} = await supabaseAdmin.from('quote_pricing_config')
      .select('config,revision').eq('id',1).maybeSingle();
    if (pricingError) throw pricingError;
    const estimate = publicEstimate(project,pricing);
    if (!body.pricing || body.pricing.revision !== estimate.revision) {
      return jsonResponse({error:'Pricing changed. Review the updated estimate and submit again.', estimate},409);
    }
    Object.assign(quoteData, quoteEstimateFields(estimate), {square_feet:project.squareFeet, status:'New'});
  }

  const accessCode = encodeBase64Url(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const accessCodeHash = await hashAccessCode(accessCode);
  const { data: quote, error: quoteError } = await supabaseAdmin
    .from('quotes')
    .insert([{ ...quoteData, photo_paths: [], tracking_token_hash: accessCodeHash }])
    .select('id,tracking_number')
    .single();

  if (quoteError) {
    throw quoteError;
  }

  const paths = files.map((file) => `quotes/${quote.id}/${sanitizeFileName(file.name)}`);
  const uploads = [];

  try {
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

  return jsonResponse({ uploads, finalizeToken, trackingNumber: quote.tracking_number, accessCode });
  } catch {
    // The request already exists. Return its one-time credentials even if upload
    // preparation failed, so the customer is not encouraged to create a duplicate.
    return jsonResponse({uploads:[], finalizeToken:null, trackingNumber:quote.tracking_number, accessCode,
      uploadPreparationError:'Request received, but attachments could not be prepared. Contact Bruno before submitting again.'},201);
  }
}

async function hashAccessCode(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function publicProject(quote: Record<string, any>) {
  const published = Boolean(quote.final_quote_sent_at);
  const finalPrice = published ? Number(quote.final_price) : null;
  const paid = published && quote.amount_paid != null ? Number(quote.amount_paid) : null;
  return {
    orderNumber: quote.tracking_number,
    projectType: quote.service || quote.product || 'Glass project',
    status: quote.project_status || 'Status not assigned',
    createdAt: quote.created_at,
    measurementCompletedAt: quote.measurement_completed_at,
    verifiedMeasurements: quote.measurement_completed_at ? { width: quote.verified_width, height: quote.verified_height } : null,
    installationStatus: quote.installation_status ?? 'Status not recorded',
    installationScheduledAt: quote.installation_scheduled_at,
    installationCompletedAt: quote.installation_completed_at,
    preliminaryEstimate: quote.estimated_price == null ? null : Number(quote.estimated_price),
    preliminaryEstimateRange: quote.estimated_price_low == null || quote.estimated_price_high == null ? null : {
      low: Number(quote.estimated_price_low), high: Number(quote.estimated_price_high) + 150
    },
    finalQuote: published ? {
      status: quote.final_quote_accepted_at ? 'Accepted' : 'Published',
      price: finalPrice,
      scope: quote.final_quote_scope,
      quoteDate: quote.final_quote_date,
      expiresAt: quote.final_quote_expires_at,
      publishedAt: quote.final_quote_sent_at,
      acceptedAt: quote.final_quote_accepted_at
    } : { status: 'Not published' },
    payment: published ? {
      requiredToCommence: finalPrice * 0.5,
      received: paid,
      remainingBalance: paid == null ? null : Math.max(0, finalPrice - paid),
      paymentDate: quote.payment_date,
      verifiedAt: quote.payment_verified_at
    } : { status: 'Shown after Bruno publishes the Final Quote' }
  };
}

async function customerTrack(body: Record<string, unknown>) {
  const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber.trim().toUpperCase() : '';
  const accessCode = typeof body.accessCode === 'string' ? body.accessCode.trim() : '';
  if (!/^BGM-\d{4}-[0-9A-F]{5,}$/.test(orderNumber) || accessCode.length < 32 || accessCode.length > 100) {
    return jsonResponse({ error: 'We could not verify that order number and access code. Check both and try again.' }, 404);
  }
  const tokenHash = await hashAccessCode(accessCode);
  const { data, error } = await supabaseAdmin.from('quotes')
    .select('tracking_number,tracking_token_hash,created_at,service,product,project_status,measurement_completed_at,verified_width,verified_height,installation_status,installation_scheduled_at,installation_completed_at,estimated_price,estimated_price_low,estimated_price_high,final_price,final_quote_sent_at,final_quote_scope,final_quote_date,final_quote_expires_at,final_quote_accepted_at,amount_paid,payment_date,payment_verified_at')
    .eq('tracking_number', orderNumber).eq('tracking_token_hash', tokenHash).maybeSingle();
  if (error) throw error;
  if (!data) return jsonResponse({ error: 'We could not verify that order number and access code. Check both and try again.' }, 404);
  return jsonResponse({ project: publicProject(data) });
}

async function acceptFinalQuote(body: Record<string, unknown>) {
  const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber.trim().toUpperCase() : '';
  const accessCode = typeof body.accessCode === 'string' ? body.accessCode.trim() : '';
  if (!/^BGM-\d{4}-[0-9A-F]{5,}$/.test(orderNumber) || accessCode.length < 32 || accessCode.length > 100) {
    return jsonResponse({ error: 'We could not verify that order number and access code.' }, 404);
  }
  const tokenHash = await hashAccessCode(accessCode);
  const { data, error } = await supabaseAdmin.from('quotes').select('id,tracking_number,tracking_token_hash,final_quote_sent_at,final_quote_expires_at,final_quote_accepted_at')
    .eq('tracking_number', orderNumber).eq('tracking_token_hash', tokenHash).maybeSingle();
  if (error) throw error;
  if (!data || !data.final_quote_sent_at) return jsonResponse({ error: 'No published Final Quote is available to accept.' }, 409);
  if (!data.final_quote_accepted_at && data.final_quote_expires_at && data.final_quote_expires_at < new Date().toISOString().slice(0,10)) return jsonResponse({ error: 'This Final Quote has expired. Contact Bruno’s Glass for an updated quote.' }, 409);
  if (!data.final_quote_accepted_at) {
    const { error: updateError } = await supabaseAdmin.from('quotes').update({final_quote_accepted_at:new Date().toISOString(),status:'Approved',project_status:'Final Quote Accepted'})
      .eq('id',data.id).not('final_quote_sent_at','is',null);
    if (updateError) throw updateError;
  }
  return customerTrack(body);
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
  const origin = request.headers.get('origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(origin)
    });
  }

  if (request.method !== 'POST') {
    return withCors(jsonResponse({ error: 'Method not allowed.' }, 405), origin);
  }

  try {
    const body = await request.json();

    if (body.action === 'create') {
      return withCors(await createQuote(body), origin);
    }

    if (body.action === 'finalize') {
      return withCors(await finalizeQuote(body.finalizeToken), origin);
    }

    if (body.action === 'track') return withCors(await customerTrack(body), origin);
    if (body.action === 'accept-final-quote') return withCors(await acceptFinalQuote(body), origin);

    return withCors(jsonResponse({ error: 'Unknown action.' }, 400), origin);
  } catch (error) {
    console.error('submit-quote error:', error);
    return withCors(jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected server error.' }, 500), origin);
  }
});
