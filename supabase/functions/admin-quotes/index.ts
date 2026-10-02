import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
  'https://brunos-glass-mirror.english-academy-fl.workers.dev',
  ...(Deno.env.get('ADDITIONAL_ALLOWED_ORIGINS') || '').split(',').map(origin=>origin.trim()).filter(Boolean)
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
const PROJECT_STAGES = new Set([
  'Quote Requested','Estimate Provided','Deposit Received','Measurement Scheduled','Measurements Verified',
  'Final Quote Preparing','Final Quote Ready','Final Quote Accepted','Fabrication','Ready for Installation',
  'Installation Scheduled','Installation In Progress','Installation Completed','Final Payment Due','Paid','Completed'
]);
const INSTALLATION_STAGES = new Set(['Not Started','Scheduled','Installation In Progress','Installation Completed']);
const QUOTE_COLUMNS = [
  'id',
  'created_at',
  'name',
  'phone',
  'email',
  'service',
  'message',
  'city',
  'installation_address',
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
  ,'tracking_number','project_status','assigned_technician','verified_width','verified_height','measurement_completed_at',
  'ai_estimated_width','ai_estimated_height','customer_confirmed_width','customer_confirmed_height','measurement_confidence','measurement_source',
  'technician_notes','measurement_photo_paths','assigned_installer','installation_status','installation_scheduled_at',
  'installer_notes','installation_photo_paths','installation_completed_at','final_quote_draft_price','final_quote_draft_scope',
  'final_quote_draft_date','final_quote_draft_expires_at','final_quote_sent_at','final_quote_scope','final_quote_date',
  'final_quote_expires_at','final_quote_accepted_at','amount_paid','payment_date','payment_verified_at'
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
  let serviceKey='';
  const secretKeysText=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeysText){try{serviceKey=JSON.parse(secretKeysText).default||'';}catch{}}
  serviceKey ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if(!serviceKey)throw new Error('Supabase service key is not configured.');
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceKey
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
  const workflowPhotos = [
    ...(Array.isArray(quote.measurement_photo_paths) ? quote.measurement_photo_paths.map(path=>({path,stage:'measurement'})) : []),
    ...(Array.isArray(quote.installation_photo_paths) ? quote.installation_photo_paths.map(path=>({path,stage:'installation'})) : [])
  ];
  const photos = [];
  for (const {path,stage} of [...photoPaths.map(path=>({path,stage:'customer'})),...workflowPhotos]) {
    const { data, error: signedUrlError } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60);

    if (!signedUrlError && data?.signedUrl) {
      photos.push({ path, stage, signedUrl: data.signedUrl });
    }
  }

  return { ...quote, photos };
}

async function updateQuote(
  supabaseAdmin: ReturnType<typeof getSecretClient>,
  body: { id: string; status?: string }
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

function textField(value: unknown, label: string, max = 4000) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${label}.`);
  return value.trim() || null;
}

async function saveFinalQuoteDraft(supabaseAdmin: ReturnType<typeof getSecretClient>, body: Record<string, unknown>) {
  if (!body.id) throw new Error('Quote id is required.');
  if (typeof body.finalPrice !== 'number' || !Number.isFinite(body.finalPrice) || body.finalPrice < 0) throw new Error('Enter a valid non-negative final price.');
  const scope = textField(body.scope,'final quote scope',10000);
  if (!scope) throw new Error('Enter the final quote scope before saving the draft.');
  if (typeof body.quoteDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.quoteDate)) throw new Error('Enter a valid quote date.');
  const expires = body.expiresAt == null || body.expiresAt === '' ? null : String(body.expiresAt);
  if (expires && (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || expires < body.quoteDate)) throw new Error('Expiration must be a valid date on or after the quote date.');
  const {data,error}=await supabaseAdmin.from('quotes').update({final_quote_draft_price:body.finalPrice,
    final_quote_draft_scope:scope,final_quote_draft_date:body.quoteDate,final_quote_draft_expires_at:expires})
    .eq('id',body.id).is('final_quote_sent_at',null).select(QUOTE_COLUMNS).maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('This final quote was already published and cannot be changed in place.');
  return data;
}

async function publishFinalQuote(supabaseAdmin: ReturnType<typeof getSecretClient>, id: unknown) {
  if(typeof id!=='string'||!id)throw new Error('Quote id is required.');
  const {data:current,error:readError}=await supabaseAdmin.from('quotes').select('final_quote_draft_price,final_quote_draft_scope,final_quote_draft_date,final_quote_draft_expires_at,final_quote_sent_at').eq('id',id).single();
  if(readError)throw readError;
  if(current.final_quote_sent_at)throw new Error('A final quote was already published for this order.');
  if(!Number.isFinite(Number(current.final_quote_draft_price))||current.final_quote_draft_price<0||!current.final_quote_draft_scope||!current.final_quote_draft_date)throw new Error('Save a complete Final Quote draft before publishing it.');
  const sentAt=new Date().toISOString();
  const updates={final_price:current.final_quote_draft_price,final_quote_scope:current.final_quote_draft_scope,
    final_quote_date:current.final_quote_draft_date,final_quote_expires_at:current.final_quote_draft_expires_at,
    final_quote_sent_at:sentAt,project_status:'Final Quote Ready',status:'Quoted'};
  const {data,error}=await supabaseAdmin.from('quotes').update(updates).eq('id',id).is('final_quote_sent_at',null).select(QUOTE_COLUMNS).maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('Another Admin published this Final Quote first. Reload the order.');
  return data;
}

async function updateProjectWorkflow(supabaseAdmin: ReturnType<typeof getSecretClient>, body: Record<string, unknown>) {
  if(typeof body.id!=='string'||!body.id)throw new Error('Quote id is required.');
  const {data:current,error:readError}=await supabaseAdmin.from('quotes').select('id,final_price,amount_paid,payment_verified_at,measurement_completed_at,installation_completed_at,installation_photo_paths,measurement_photo_paths,verified_width,verified_height,project_status,installation_status,final_quote_sent_at,final_quote_accepted_at').eq('id',body.id).single();
  if(readError)throw readError;
  const updates:Record<string,unknown>={};
  if(body.projectStatus!==undefined){if(typeof body.projectStatus!=='string'||!PROJECT_STAGES.has(body.projectStatus))throw new Error('Invalid project status.');updates.project_status=body.projectStatus;}
  if(body.technician!==undefined)updates.assigned_technician=textField(body.technician,'technician',160);
  if(body.installer!==undefined)updates.assigned_installer=textField(body.installer,'installer',160);
  if(body.verifiedWidth!==undefined)updates.verified_width=textField(body.verifiedWidth,'verified width',80);
  if(body.verifiedHeight!==undefined)updates.verified_height=textField(body.verifiedHeight,'verified height',80);
  if(body.measurementCompleted!==undefined){if(typeof body.measurementCompleted!=='boolean')throw new Error('Invalid measurement completion flag.');if(body.measurementCompleted&&(!String(updates.verified_width??current.verified_width??'').trim()||!String(updates.verified_height??current.verified_height??'').trim()))throw new Error('Enter both verified dimensions before marking measurements complete.');updates.measurement_completed_at=body.measurementCompleted?new Date().toISOString():null;}
  if(body.technicianNotes!==undefined)updates.technician_notes=textField(body.technicianNotes,'technician notes',10000);
  if(body.installationStatus!==undefined){if(typeof body.installationStatus!=='string'||!INSTALLATION_STAGES.has(body.installationStatus))throw new Error('Invalid installation status.');updates.installation_status=body.installationStatus;if(body.installationStatus==='Installation Completed')updates.installation_completed_at=new Date().toISOString();}
  if(body.installationScheduledAt!==undefined){const v=body.installationScheduledAt;if(v&&Number.isNaN(Date.parse(String(v))))throw new Error('Invalid installation schedule date.');updates.installation_scheduled_at=v?new Date(String(v)).toISOString():null;}
  if(body.installerNotes!==undefined)updates.installer_notes=textField(body.installerNotes,'installer notes',10000);
  if(body.measurementPhotoPaths!==undefined)updates.measurement_photo_paths=validatePhotoPaths(body.measurementPhotoPaths,body.id,'measurement');
  if(body.installationPhotoPaths!==undefined)updates.installation_photo_paths=validatePhotoPaths(body.installationPhotoPaths,body.id,'installation');
  if(body.amountPaid!==undefined){const amount=Number(body.amountPaid);if(!Number.isFinite(amount)||amount<0)throw new Error('Recorded payments must be a non-negative amount.');updates.amount_paid=amount;updates.payment_verified_at=amount>0?new Date().toISOString():null;}
  if(body.paymentDate!==undefined){const value=body.paymentDate;if(value&&!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))throw new Error('Invalid payment date.');updates.payment_date=value||null;}
  const stage=String(updates.project_status||current.project_status||'');
  const paid=Number(updates.amount_paid??current.amount_paid??0);
  const finalPrice=Number(current.final_price??0);
  const paymentStages=['Deposit Received','Fabrication','Ready for Installation','Installation Scheduled','Installation In Progress','Installation Completed','Final Payment Due','Paid','Completed'];
  if(stage==='Deposit Received'&&paid<=0)throw new Error('Record the deposit received before advancing to this stage.');
  if(paymentStages.filter(item=>item!=='Deposit Received').includes(stage)&&(!current.final_quote_sent_at||!finalPrice||paid<finalPrice*.5))throw new Error('Publish the Final Quote and verify at least 50% payment before advancing to this stage.');
  const installationStage=String(updates.installation_status||current.installation_status||'');
  if(['Installation Scheduled','Installation In Progress','Installation Completed'].includes(stage)&&(!current.measurement_completed_at&&!updates.measurement_completed_at))throw new Error('Complete and verify field measurements before advancing to installation.');
  if(['Paid','Completed'].includes(stage)&&(!current.final_quote_sent_at||paid<finalPrice))throw new Error('Record verified full payment against the published Final Quote before marking this order paid or completed.');
  if(stage==='Final Quote Ready'&&!current.final_quote_sent_at)throw new Error('Publish the Final Quote before marking it ready.');
  if(stage==='Final Quote Accepted'&&!current.final_quote_accepted_at)throw new Error('The customer must accept the published Final Quote before advancing to this stage.');
  if(stage==='Installation Completed'&&installationStage!=='Installation Completed')throw new Error('Confirm installation completion in the installation status first.');
  if(!Object.keys(updates).length)throw new Error('No workflow changes provided.');
  const {data,error}=await supabaseAdmin.from('quotes').update(updates).eq('id',body.id).select(QUOTE_COLUMNS).single();
  if(error)throw error;
  return data;
}

function validatePhotoPaths(value: unknown,id: string,stage: string) {
  if(!Array.isArray(value)||value.length>20||value.some(path=>typeof path!=='string'||!path.startsWith(`quotes/${id}/workflow/${stage}/`)))throw new Error('Invalid workflow photo list.');
  return value;
}

async function prepareWorkflowUploads(supabaseAdmin: ReturnType<typeof getSecretClient>,body:Record<string,unknown>) {
  if(typeof body.id!=='string'||!body.id)throw new Error('Quote id is required.');
  if(!['measurement','installation'].includes(String(body.stage)))throw new Error('Invalid workflow photo stage.');
  if(!Array.isArray(body.files)||body.files.length>10)throw new Error('Choose up to 10 workflow photos.');
  const uploads=[];
  for(const file of body.files as Array<{name:string;size:number;type:string}>) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>50*1024*1024)throw new Error('Workflow photos must be JPEG, PNG or WebP and no larger than 50 MB.');
    const path=`quotes/${body.id}/workflow/${body.stage}/${crypto.randomUUID()}-${file.name.split('.').pop()?.replace(/[^a-z0-9]/gi,'').toLowerCase()||'jpg'}`;
    const {data,error}=await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
    if(error)throw error;
    uploads.push({path,token:data.token});
  }
  return uploads;
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

    if (body.action === 'save-final-quote-draft') {
      return response({ quote: await saveFinalQuoteDraft(supabaseAdmin, body) }, 200, origin);
    }

    if (body.action === 'publish-final-quote') {
      return response({ quote: await publishFinalQuote(supabaseAdmin, body.id) }, 200, origin);
    }

    if (body.action === 'update-project-workflow') {
      return response({ quote: await updateProjectWorkflow(supabaseAdmin, body) }, 200, origin);
    }

    if (body.action === 'prepare-workflow-uploads') {
      return response({ uploads: await prepareWorkflowUploads(supabaseAdmin, body) }, 200, origin);
    }

    return response({ error: 'Unknown action.' }, 400, origin);
  } catch (error) {
    console.error('admin-quotes error:', error);
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    const status = message.includes('Authentication') || message.includes('Administrator') || message.includes('Invalid authentication') ? 401 : 400;
    return response({ error: message }, status, origin);
  }
});
