import {spawnSync} from 'node:child_process';
import {cpSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const projectRef=process.argv[2];
if(!/^[a-z]{20}$/.test(projectRef||''))throw Error('Pass the dedicated staging project ref.');
const outputDir=resolve('.staging-dist');
if(existsSync(outputDir))throw Error('Staging output already exists; preserving it. Move it aside yourself before rebuilding.');
const cliPath=resolve(process.env.APPDATA||'','npm','node_modules','supabase','dist','supabase.js');
const result=spawnSync(process.execPath,[cliPath,'projects','api-keys','--project-ref',projectRef,'--output-format','json'],{encoding:'utf8',windowsHide:true});
if(result.status!==0)throw Error(`Could not read staging public-key metadata (status ${result.status??'unavailable'}). No key values were printed.`);
let keys;
try{keys=JSON.parse(result.stdout);}catch{throw Error('Staging key metadata was not valid JSON.');}
const entries=Array.isArray(keys)?keys:(Array.isArray(keys?.keys)?keys.keys:[]);
const publishable=entries.find(row=>row?.type==='publishable'&&typeof row.api_key==='string'&&row.api_key.startsWith('sb_publishable_'))?.api_key;
if(!publishable)throw Error('A Supabase sb_publishable_ key is required; secret keys are never used in the browser.');
cpSync(resolve('dist'),outputDir,{recursive:true,errorOnExist:true});
const stagingQrAssets=resolve('staging-assets','referral-qr');
if(existsSync(stagingQrAssets))cpSync(stagingQrAssets,resolve(outputDir,'images','referral-qr'),{recursive:true,force:true});
const stageConfig=`// Public frontend settings for the isolated staging project only.\nglobalThis.BRUNO_PUBLIC_CONFIG=Object.freeze({supabaseUrl:'https://${projectRef}.supabase.co',supabasePublishableKey:'${publishable}'});\n`;
writeFileSync(resolve(outputDir,'runtime-config.js'),stageConfig);
for(const page of ['index.html','admin.html']){
  const path=resolve(outputDir,page),html=readFileSync(path,'utf8');
  if(!html.includes('<script src="runtime-config.js"></script>'))throw Error(`${page} is missing the runtime config script tag.`);
}
for(const file of ['runtime-config.js','script.js','project-tracking.js','admin.js']){
  const content=readFileSync(resolve(outputDir,file),'utf8');
  if(content.includes('ygcpfehitvhipsncqxdm')||content.includes('sb_publishable_uHHniNJW39sY0x3afdkx1g_53ZJrTHl'))throw Error('Production Supabase config remained in staging assets.');
}
writeFileSync(resolve(outputDir,'_headers'),'/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n\n/runtime-config.js\n  Cache-Control: no-store\n',{flag:'wx'});
console.log('Prepared isolated staging assets. The publishable key was not printed.');
