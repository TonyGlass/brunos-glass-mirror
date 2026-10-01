import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const submit=readFileSync(new URL('../supabase/functions/submit-quote/index.ts',import.meta.url),'utf8');
const admin=readFileSync(new URL('../supabase/functions/admin-quotes/index.ts',import.meta.url),'utf8');
const analyzePhoto=readFileSync(new URL('../supabase/functions/analyze-photo/index.ts',import.meta.url),'utf8');
const adminUi=readFileSync(new URL('../admin.js',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/202609300001_admin_final_quote_customer_tracking.sql',import.meta.url),'utf8');
const tracking=readFileSync(new URL('../project-tracking.js',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../project-workflow.js',import.meta.url),'utf8');

test('new customer orders receive unique BGM order numbers and one-time high-entropy credentials',()=>{
  assert.match(migration,/create sequence if not exists public\.project_order_number_seq/);
  assert.match(migration,/order_sequence := nextval\('public\.project_order_number_seq'\)/);
  assert.match(migration,/new\.tracking_number := 'BGM-'[\s\S]*greatest\(5, length\(to_hex\(order_sequence\)\)\)/,'Sequence values longer than five hex digits must not be truncated.');
  assert.match(migration,/create unique index if not exists quotes_tracking_number_unique/);
  assert.match(submit,/crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(submit,/tracking_token_hash: accessCodeHash/);
  assert.match(submit,/trackingNumber: quote\.tracking_number, accessCode/);
  assert.doesNotMatch(tracking,/URLSearchParams|location\.search/);
});

test('customer tracking requires order number and secret hash and returns a limited public projection',()=>{
  assert.match(submit,/\.eq\('tracking_number', orderNumber\)\.eq\('tracking_token_hash', tokenHash\)/);
  assert.match(submit,/We could not verify that order number and access code/);
  const publicProjection=submit.slice(submit.indexOf('function publicProject'),submit.indexOf('async function customerTrack'));
  for(const forbidden of ['tracking_token_hash','technician_notes','installer_notes','installation_address','email','phone','name','final_quote_draft']) assert.doesNotMatch(publicProjection,new RegExp(forbidden));
  assert.match(publicProjection,/const published = Boolean\(quote\.final_quote_sent_at\)/);
  assert.match(publicProjection,/remainingBalance: paid == null \? null : Math\.max\(0, finalPrice - paid\)/);
  assert.match(submit,/action === 'accept-final-quote'/);
  assert.match(tracking,/Acceptance records your approval only/);
});

test('Final Quote remains Admin-only, unpublished drafts are gated, and technicians have no price write path',()=>{
  assert.match(admin,/async function requireAdmin/);
  assert.match(admin,/Administrator access required/);
  assert.match(admin,/save-final-quote-draft/);
  assert.match(admin,/publish-final-quote/);
  assert.match(admin,/\.is\('final_quote_sent_at',null\)/);
  assert.match(admin,/final_price:current\.final_quote_draft_price/);
  const genericUpdate=admin.slice(admin.indexOf('async function updateQuote'),admin.indexOf('function textField'));
  assert.doesNotMatch(genericUpdate,/final_price|finalPrice/);
  assert.match(workflow,/Only Bruno\/Admin can edit this draft/);
  assert.match(workflow,/Technician notes \(internal\)/);
  assert.match(workflow,/Installer notes \(internal\)/);
});

test('Admin project workspace separates draft price from customer-facing publication',()=>{
  const context={window:{}};vm.runInNewContext(workflow,context);
  const html=context.window.ProjectWorkflow.render({id:'secret-internal-db-id',tracking_number:'BGM-2026-00001',name:'Customer',project_status:'Quote Requested',status:'New',photos:[],verified_width:null,verified_height:null,amount_paid:0},{
    escapeHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
    formatMoney:value=>value==null?'Not recorded':`$${Number(value).toFixed(2)}`,formatDate:value=>String(value||'Not recorded'),estimateLabel:()=> 'Not recorded',storedBaseEstimateLabel:()=> 'Not recorded',referralSourceLabel:()=> 'Not provided',supportedStatuses:['New','Reviewing','Quoted'],finalDifference:'Pending'
  });
  assert.match(html,/BGM-2026-00001/);
  assert.doesNotMatch(html,/secret-internal-db-id/);
  assert.match(html,/id="final-quote-form"/);
  assert.match(html,/id="project-workflow-form"/);
  assert.match(html,/Publish Final Quote/);
  assert.match(html,/Measurements completed and verified/);
});

test('migration is additive to quotes and does not alter pricing config or RLS',()=>{
  assert.match(migration,/alter table public\.quotes/);
  assert.doesNotMatch(migration,/quote_pricing_config|enable row level security|force row level security|create policy|drop policy/i);
  assert.match(migration,/add column if not exists project_status text,/);
  assert.match(migration,/add column if not exists amount_paid numeric check \(amount_paid is null or amount_paid >= 0\)/);
  assert.match(migration,/alter column project_status set default 'Quote Requested'/);
  assert.match(migration,/alter column amount_paid set default 0/);
  assert.match(migration,/revoke all on function public\.assign_quote_tracking_number\(\) from public, anon, authenticated/);
  assert.doesNotMatch(migration,/project_status text not null default|amount_paid numeric not null default/i);
  assert.match(workflow,/Stage not assigned \(pre-migration\)/);
  assert.match(workflow,/Unknown \(legacy record\)/);
  assert.match(workflow,/quote\.amount_paid == null \? 'Unknown until verified'/);
  assert.match(submit,/quote\.amount_paid != null \? Number\(quote\.amount_paid\) : null/);
  assert.match(submit,/remainingBalance: paid == null \? null/);
  assert.match(submit,/installationStatus: quote\.installation_status \?\? 'Status not recorded'/);
  assert.match(workflow,/Not assigned \(choose when known\)/);
  assert.match(adminUi,/if\(form\.elements\.amountPaid\.value\.trim\(\)!==''\)data\.amountPaid=Number/);
  assert.match(admin,/requireAdmin\(request\)/);
});

test('Supabase Edge Function source parses after TypeScript type stripping',()=>{
  for(const source of [submit,admin,analyzePhoto]) {
    const stripped=stripTypeScriptTypes(source.replace(/^\uFEFF/,'').replace(/^import.*(?:\r?\n|$)/gm,''));
    assert.doesNotThrow(()=>new vm.Script(stripped));
  }
});
