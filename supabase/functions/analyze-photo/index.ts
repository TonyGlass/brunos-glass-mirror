import {SHOWER_CONFIGURATIONS,SHOWER_GEOMETRIES,constrainShowerRecommendations} from '../_shared/photo-geometry.mjs';

const allowedOrigins = new Set(['http://localhost:8000','http://127.0.0.1:8000',
  'http://localhost:8765','http://127.0.0.1:8765',
  'https://brunos-glass-mirror-staging.english-academy-fl.workers.dev',
  'https://brunos-glass-mirror.english-academy-fl.workers.dev',
  ...(Deno.env.get('ADDITIONAL_ALLOWED_ORIGINS') || '').split(',').map(origin=>origin.trim()).filter(Boolean)]);
const configs = SHOWER_CONFIGURATIONS;
const mimeTypes = new Set(['image/jpeg','image/png','image/webp']);
const buckets = new Map<string,{count:number;until:number}>();
function reply(body:unknown,status=200,origin='') {
  const headers:Record<string,string>={'content-type':'application/json','cache-control':'no-store','vary':'Origin',
    'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, apikey, content-type, x-client-info'};
  if(allowedOrigins.has(origin))headers['access-control-allow-origin']=origin;
  return new Response(status===204?null:JSON.stringify(body),{status,headers});
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
    if(!match||!mimeTypes.has(match[1])||match[2].length>11_185_000||match[2].length%4!==0)return reply({error:'Choose a JPG, PNG or WebP photo up to 8 MB.'},400,origin);
    const padding=match[2].endsWith('==')?2:match[2].endsWith('=')?1:0;
    if(match[2].length/4*3-padding>8*1024*1024)return reply({error:'Choose a JPG, PNG or WebP photo up to 8 MB.'},400,origin);
    const model=Deno.env.get('OPENAI_VISION_MODEL')||'gpt-4.1-mini';
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({model,store:false,
      instructions:"Analyze the visible project and opening. Classify geometry before proposing any layouts, filter incompatible catalog layouts before ranking, and rank only the remaining compatible options. For straight_tub_alcove, the approved catalog family is Tub Enclosure (best match) then Sliding Door (alternative); never return Corner / 90-degree, Neo-Angle, multi-sided, Fixed Panel / Walk-In, Swing Door + Fixed Panel, or 3-panel for this geometry because no approved tub-specific rule permits those options. For straight_shower_opening, only return Sliding Door, Swing Door + Fixed Panel, or Fixed Panel / Walk-In in that priority order. For corner_90, only return 90° Corner. The current Bruno catalog has no Neo-Angle configuration, so neo_angle must return only Not Sure — Let Bruno’s recommend it. If geometry is unclear or confidence is below .65, use geometry unclear and only Not Sure — Let Bruno’s recommend it; never force a recommendation because a photo exists. Use only the provided Bruno configuration names and existing catalog mappings. Estimate opening dimensions only with a clearly identifiable, reliable known-size reference (such as a standard bathtub shown straight-on). If scale is uncertain, return null for both dimensions and request a straight-on photo with a known-size reference or one known measurement. If usable, give conservative whole-inch preliminary estimates only, no fractional precision or verified/fabrication claims. Return an openingBox around the opening. Bruno’s professional field measurement is required before fabrication.",
      input:[{role:'user',content:[{type:'input_text',text:`Analyze this project photo. Allowed shower configuration names: ${configs.join('; ')}.`},{type:'input_image',image_url:body.image,detail:'auto'}]}],
      text:{format:{type:'json_schema',name:'project_photo_analysis',strict:true,schema:{type:'object',additionalProperties:false,properties:{category:{type:'string',enum:['shower_glass','mirror','architectural_glass','unclear']},confidence:{type:'number'},geometry:{type:'string',enum:SHOWER_GEOMETRIES},geometryConfidence:{type:'number'},geometryReasoning:{type:'string'},reasoning:{type:'string'},openingBox:{type:'object',additionalProperties:false,properties:{x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'}},required:['x','y','width','height']},measurement:{type:'object',additionalProperties:false,properties:{widthInches:{anyOf:[{type:'number'},{type:'null'}]},heightInches:{anyOf:[{type:'number'},{type:'null'}]},confidence:{type:'number'},basis:{type:'string'},referenceSuggestion:{type:'string'}},required:['widthInches','heightInches','confidence','basis','referenceSuggestion']},recommendations:{type:'array',items:{type:'object',additionalProperties:false,properties:{configuration:{type:'string',enum:configs},reason:{type:'string'}},required:['configuration','reason']}}},required:['category','confidence','geometry','geometryConfidence','geometryReasoning','reasoning','openingBox','measurement','recommendations']}}}})});
    if(!response.ok){
      const failure:any=await response.json().catch(()=>({}));
      const safeCode=(value:unknown)=>typeof value==='string'&&/^[a-z0-9_-]{1,80}$/i.test(value)?value:null;
      return reply({error:'Photo analysis is temporarily unavailable. Continue with manual configuration and tape measurements.',providerStatus:response.status,providerErrorType:safeCode(failure?.error?.type),providerErrorCode:safeCode(failure?.error?.code)},502,origin);
    }
    const data=await response.json(),text=data.output?.flatMap((item:any)=>item.content||[]).find((part:any)=>part.type==='output_text')?.text;
    if(typeof text!=='string')return reply({error:'Photo analysis returned no usable result. Continue manually.'},502,origin);
    const result=JSON.parse(text);
    if(!['shower_glass','mirror','architectural_glass','unclear'].includes(result.category)||!Number.isFinite(result.confidence)||result.confidence<0||result.confidence>1||typeof result.geometryReasoning!=='string'||typeof result.reasoning!=='string'||!Array.isArray(result.recommendations)||result.recommendations.length>3||result.recommendations.some((r:any)=>!configs.includes(r.configuration)||typeof r.reason!=='string'))return reply({error:'Photo analysis returned an invalid result. Continue manually.'},502,origin);
    const box=result.openingBox;
    const openingBox=box&&[box.x,box.y,box.width,box.height].every((n:any)=>Number.isFinite(n)&&n>=0&&n<=1)&&box.width>0&&box.height>0&&box.x+box.width<=1&&box.y+box.height<=1?box:null;
    const measured=result.measurement;
    const dimensionsVisible=Number.isFinite(measured?.widthInches)&&Number.isFinite(measured?.heightInches)&&measured.widthInches>=12&&measured.widthInches<=240&&measured.heightInches>=12&&measured.heightInches<=240;
    const measurement=dimensionsVisible&&Number.isFinite(measured.confidence)&&measured.confidence>=.75&&typeof measured.basis==='string'&&measured.basis.trim().length>=12
      ?{widthInches:Math.round(measured.widthInches),heightInches:Math.round(measured.heightInches),confidence:measured.confidence,basis:measured.basis.slice(0,300),referenceSuggestion:''}
      :{widthInches:null,heightInches:null,confidence:Number.isFinite(measured?.confidence)?Math.max(0,Math.min(1,measured.confidence)):0,basis:typeof measured?.basis==='string'?measured.basis.slice(0,300):'',referenceSuggestion:typeof measured?.referenceSuggestion==='string'&&measured.referenceSuggestion.trim()?measured.referenceSuggestion.slice(0,240):'Add one straight-on photo that includes a clearly known-size reference, or provide one known measurement.'};
    const geometryResult=result.category==='shower_glass'
      ?constrainShowerRecommendations({geometry:result.geometry,geometryConfidence:result.geometryConfidence,recommendations:result.recommendations})
      :{geometry:'unclear',geometryConfidence:0,recommendations:[]};
    const usage=data.usage&&Number.isFinite(data.usage.input_tokens)&&Number.isFinite(data.usage.output_tokens)
      ?{inputTokens:data.usage.input_tokens,outputTokens:data.usage.output_tokens,totalTokens:Number.isFinite(data.usage.total_tokens)?data.usage.total_tokens:data.usage.input_tokens+data.usage.output_tokens}:null;
    return reply({model:typeof data.model==='string'?data.model:model,category:result.category,confidence:result.confidence,reasoning:result.reasoning.slice(0,500),...geometryResult,geometryReasoning:result.geometryReasoning.slice(0,400),openingBox,measurement,usage},200,origin);
  } catch {return reply({error:'Photo analysis is temporarily unavailable. Continue with manual configuration and tape measurements.'},502,origin);}
});
