const allowedOrigins = new Set(['http://localhost:8000','http://127.0.0.1:8000',
  'http://localhost:8765','http://127.0.0.1:8765',
  'https://brunos-glass-mirror.english-academy-fl.workers.dev',
  ...(Deno.env.get('ADDITIONAL_ALLOWED_ORIGINS') || '').split(',').map(origin=>origin.trim()).filter(Boolean)]);
const configs = ['Sliding Door','Swing Door + Fixed Panel','90° Corner','Fixed Panel / Walk-In','Tub Enclosure','Not Sure / Let Bruno’s recommend it'];
const mimeTypes = new Set(['image/jpeg','image/png','image/webp']);
const buckets = new Map<string,{count:number;until:number}>();
function reply(body:unknown,status=200,origin='') {
  const headers:Record<string,string>={'content-type':'application/json','cache-control':'no-store','vary':'Origin',
    'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, apikey, content-type, x-client-info'};
  if(allowedOrigins.has(origin))headers['access-control-allow-origin']=origin;
  return new Response(JSON.stringify(body),{status,headers});
}
function limited(request:Request) {
  // Best-effort per-isolate protection. Production activation also requires an upstream durable rate limit.
  const address=request.headers.get('cf-connecting-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
  const now=Date.now(), current=buckets.get(address);
  if(!current||current.until<=now){buckets.set(address,{count:1,until:now+60_000});return false;}
  current.count++;return current.count>5;
}
Deno.serve(async request=>{
  const origin=request.headers.get('origin')||'';
  if(request.method==='OPTIONS')return reply({},204,origin);
  if(request.method!=='POST')return reply({error:'Method not allowed.'},405,origin);
  if(origin&&!allowedOrigins.has(origin))return reply({error:'Origin is not allowed.'},403,origin);
  if(limited(request))return reply({error:'Too many photo analysis requests. Try again shortly.'},429,origin);
  const key=Deno.env.get('OPENAI_API_KEY');
  if(!key)return reply({error:'Photo analysis is not configured. Continue with manual configuration and tape measurements.'},503,origin);
  try {
    const declared=Number(request.headers.get('content-length')||0);if(declared>11_300_000)return reply({error:'Photo is too large. Choose an image up to 8 MB.'},413,origin);
    const reader=request.body?.getReader();if(!reader)return reply({error:'Photo content is required.'},400,origin);
    const chunks:Uint8Array[]=[];let total=0;
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>11_300_000){await reader.cancel();return reply({error:'Photo is too large. Choose an image up to 8 MB.'},413,origin);}chunks.push(value);}
    const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const raw=new TextDecoder().decode(bytes);
    const body=JSON.parse(raw),match=typeof body?.image==='string'?body.image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/):null;
    if(!match||!mimeTypes.has(match[1])||match[2].length>11_185_000)return reply({error:'Choose a JPG, PNG or WebP photo up to 8 MB.'},400,origin);
    const model=Deno.env.get('OPENAI_VISION_MODEL')||'gpt-4.1-mini';
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({model,store:false,
      instructions:'Classify the visible project category and, only for a likely shower enclosure, recommend up to three plausible configurations from the exact allowed list. This is a recommendation from a photograph, not a site inspection. Never estimate, infer, output, or claim physical measurements, dimensions, scale, clearance, or fit. Give a brief visual reason and a cautious model-estimated confidence from 0 to 1. If uncertain use unclear and no recommendations.',
      input:[{role:'user',content:[{type:'input_text',text:`Analyze this project photo. Allowed shower configuration names: ${configs.join('; ')}.`},{type:'input_image',image_url:body.image,detail:'auto'}]}],
      text:{format:{type:'json_schema',name:'project_photo_analysis',strict:true,schema:{type:'object',additionalProperties:false,properties:{category:{type:'string',enum:['shower_glass','mirror','architectural_glass','unclear']},confidence:{type:'number'},reasoning:{type:'string'},recommendations:{type:'array',items:{type:'object',additionalProperties:false,properties:{configuration:{type:'string',enum:configs},reason:{type:'string'}},required:['configuration','reason']}}},required:['category','confidence','reasoning','recommendations']}}}})});
    if(!response.ok)return reply({error:'Photo analysis is temporarily unavailable. Continue with manual configuration and tape measurements.'},502,origin);
    const data=await response.json(),text=data.output?.flatMap((item:any)=>item.content||[]).find((part:any)=>part.type==='output_text')?.text;
    if(typeof text!=='string')return reply({error:'Photo analysis returned no usable result. Continue manually.'},502,origin);
    const result=JSON.parse(text);
    if(!['shower_glass','mirror','architectural_glass','unclear'].includes(result.category)||!Number.isFinite(result.confidence)||result.confidence<0||result.confidence>1||typeof result.reasoning!=='string'||!Array.isArray(result.recommendations)||result.recommendations.length>3||result.recommendations.some((r:any)=>!configs.includes(r.configuration)||typeof r.reason!=='string'))return reply({error:'Photo analysis returned an invalid result. Continue manually.'},502,origin);
    return reply({category:result.category,confidence:result.confidence,reasoning:result.reasoning.slice(0,500),recommendations:result.category==='shower_glass'?result.recommendations:[]},200,origin);
  } catch {return reply({error:'Photo analysis is temporarily unavailable. Continue with manual configuration and tape measurements.'},502,origin);}
});
