const SUPABASE_URL = globalThis.BRUNO_PUBLIC_CONFIG.supabaseUrl;
const SUPABASE_PUBLISHABLE_KEY = globalThis.BRUNO_PUBLIC_CONFIG.supabasePublishableKey;
const ADMIN_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/admin-quotes`;
let supabaseClient = null;
try {
  supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) || null;
} catch (error) {
  console.error('Admin authentication client failed to initialize.', error);
}
const statuses = ['NEW', 'QUOTE REQUESTED', 'REVIEWING', 'QUOTED', 'APPROVED', 'DEPOSIT PAID', 'SCHEDULED', 'INSTALLATION IN PROGRESS', 'COMPLETED', 'CLOSED'];
const BACKEND_STATUSES = new Set(['New', 'Reviewing', 'Quoted', 'Approved', 'Completed', 'Lost']);
const PROJECT_WORKSPACE_KEY = 'brunoProjectWorkspaceV1';

const loginPanel = document.querySelector('#login-panel');
const crmPanel = document.querySelector('#crm-panel');
const loginForm = document.querySelector('#login-form');
const loginStatus = document.querySelector('#login-status');
const crmStatus = document.querySelector('#crm-status');
const quotesBody = document.querySelector('#quotes-body');
const quoteCount = document.querySelector('#quote-count');
const emptyState = document.querySelector('#empty-state');
const detail = document.querySelector('#quote-detail');
const quotes = new Map();
let selectedQuoteId = null;
let adminSessionActive = false;
let quoteLoadVersion = 0;

function workspaceFor(quote) {
  try {
    const all = JSON.parse(localStorage.getItem(PROJECT_WORKSPACE_KEY) || '{}');
    return all[String(quote.id)] || {
      quote_number: `DRAFT-${quote.id}`,
      status: quote.status || 'NEW',
      final_price: quote.final_price ?? '',
      amount_paid: '',
      payment_date: '',
      address: '',
      glass_thickness: '',
      hardware: quote.handle_style || '',
      fabrication: '',
      installation: '',
      additional_work: '',
      notes: '',
      terms: 'Final price is confirmed after Bruno reviews the project. Estimated price is not the final price.',
      door_size: '', panel_size: '', installation_instructions: '', special_instructions: '', bruno_notes: '',
      installer_name: '', completed_date: '', final_observations: '', problems: '', extra_work: '', final_photos: []
    };
  } catch { return { status: 'NEW', final_photos: [] }; }
}

function saveWorkspace(quote, updates) {
  const all = JSON.parse(localStorage.getItem(PROJECT_WORKSPACE_KEY) || '{}');
  all[String(quote.id)] = { ...workspaceFor(quote), ...updates, updated_at: new Date().toISOString() };
  localStorage.setItem(PROJECT_WORKSPACE_KEY, JSON.stringify(all));
  return all[String(quote.id)];
}

const PRICING_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/pricing`;
const sellingRateRows = [
  ['Clear Glass - 3/8','3/8 Clear',45,'glass'],['Low-Iron Glass - 3/8','3/8 Low Iron',60,'glass'],
  ['Reeded / Moru - 3/8','3/8 Reeded',80,'glass'],['Satin Acid-Etched - 3/8','3/8 Acid Etched',75,'glass'],
  ['Satin Acid-Etched Low-Iron - 3/8','3/8 Low Iron Acid Etched',120,'glass'],
  ['Clear Glass - 1/2','1/2 Clear',55,'glass'],['Low-Iron Glass - 1/2','1/2 Low Iron',70,'glass'],
  ['Clear Mirror - 1/4','1/4 Clear Mirror',45,'mirror'],['Low-Iron Mirror - 1/4','1/4 Low Iron Mirror',65,'mirror'],
  ['Bronze Mirror - 1/4','1/4 Bronze Mirror',75,'mirror'],['Gray Mirror - 1/4','1/4 Grey Mirror',75,'mirror'],
  ['Metal Frame','Metal / Frame add-on',15,'frame']
];
const sellingRateKey = label => label.toLowerCase().replaceAll('"','').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const makeSellingDefaults = () => ({pricingModel:'selling-rates-v1',finalSellingRates:Object.fromEntries(
  sellingRateRows.map(([material,,rate])=>[sellingRateKey(material),rate])
),enduroShieldRate:7});
let pricingDraft = makeSellingDefaults();
let centralPricingRevision = null;
let pricingLoadVersion = 0;
const pricingForm = document.querySelector('#pricing-settings-form');
const pricingStatus = document.querySelector('#pricing-settings-status');
function setStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', isError);
}
function lockPricing(locked) {
  pricingForm?.querySelectorAll('input,button').forEach(field => { field.disabled = locked; });
}
function showPricingState(state, record = null) {
  document.querySelector('#central-pricing-state').textContent = `Central pricing \u2014 ${state}`;
  const date = record?.updated_at ? new Date(record.updated_at) : null;
  document.querySelector('#central-pricing-meta').textContent = record
    ? `Revision ${record.revision} | Last updated: ${date && !Number.isNaN(date.valueOf()) ? date.toLocaleString() : 'Not available'}`
    : state === 'Not configured' ? 'No central selling prices saved.' : 'No central configuration loaded.';
}
function markPricingDraft(dirty) { document.querySelector('#central-pricing-draft').hidden = !dirty; }
function renderSellingRateInputs() {
  const target=document.querySelector('#customer-selling-rates');
  let currentGroup='';
  target.innerHTML=sellingRateRows.map(([material,title,,group])=>{const key=sellingRateKey(material);const heading=group!==currentGroup?`<h3 class="selling-rate-group">${group==='glass'?'Glass selling rates':group==='mirror'?'Mirror selling rates':'Metal / Frame'}</h3>`:'';currentGroup=group;return `${heading}<div class="settings-cost-row"><span>${title} ($/sq ft)</span><label>Price<input name="rate.${key}" type="number" min="0" step="0.01" required /></label></div>`}).join('');
}
renderSellingRateInputs();
function fillPricingSettings() {
  for (const input of pricingForm.querySelectorAll('[name]')) {
    const value=input.name==='enduroShieldRate'?pricingDraft.enduroShieldRate:pricingDraft.finalSellingRates?.[input.name.slice(5)];
    input.value=value == null?'':String(value);
  }
}

async function callPricing(action, payload = {}) {
  if (!supabaseClient?.auth) throw Error('Admin sign-in could not initialize. Reload the page and try again.');
  const {data:{session}} = await supabaseClient.auth.getSession();
  if (!session?.access_token) throw Error('Sign in to an authorized Admin account before managing selling prices.');
  const response = await fetch(PRICING_FUNCTION_URL, {method:'POST',cache:'no-store',headers:{
    'Content-Type':'application/json',apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${session.access_token}`
  },body:JSON.stringify({action,...payload})});
  let result;
  try { result = await response.json(); }
  catch { throw Error('Central pricing returned an unreadable response. Reload central pricing and try again.'); }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw Error('Admin authorization failed. Sign in with an authorized Admin account and try again.');
    throw Error(result.error || `Central pricing request failed (HTTP ${response.status}).`);
  }
  return result;
}

async function loadCentralPricing() {
  if (!supabaseClient?.auth) {
    setStatus(pricingStatus,'Admin sign-in could not initialize. Reload the page and try again.',true);
    return;
  }
  const version = ++pricingLoadVersion;
  centralPricingRevision = null;
  lockPricing(true);
  showPricingState('Loading');
  setStatus(pricingStatus,'Loading saved central selling prices...');
  try {
    const {pricing} = await callPricing('read');
    if (version !== pricingLoadVersion || !adminSessionActive) return;
    pricingDraft = pricing?.config?.pricingModel === 'selling-rates-v1'
      ? pricing.config : makeSellingDefaults();
    centralPricingRevision = pricing?.revision ?? 0;
    showPricingState(pricing ? 'Saved' : 'Not configured',pricing);
    markPricingDraft(false);
    fillPricingSettings();
    setStatus(pricing
      ? pricing.config?.pricingModel === 'selling-rates-v1'
        ? `Central pricing loaded. Revision ${pricing.revision}; updated ${pricing.updated_at ? new Date(pricing.updated_at).toLocaleString() : 'timestamp unavailable'}.`
        : 'A legacy pricing configuration is saved. Review the confirmed selling rates before replacing it.'
      : 'No central configuration is saved. Confirm the selling rates, then save them centrally.');
  } catch (error) {
    if (version !== pricingLoadVersion) return;
    setStatus(pricingStatus,`${error.message} No pricing was saved.`,true);
    showPricingState('Unavailable');
  } finally {
    if (version === pricingLoadVersion) lockPricing(!adminSessionActive);
  }
}

async function savePricingSettings(event) {
  event?.preventDefault?.();
  if (!supabaseClient?.auth) {
    setStatus(pricingStatus,'Admin sign-in could not initialize. Reload the page before saving.',true);
    return;
  }
  let session;
  try {
    ({data:{session}} = await supabaseClient.auth.getSession());
  } catch (error) {
    setStatus(pricingStatus,`Could not verify your Admin session: ${error.message}. No pricing was saved.`,true);
    return;
  }
  if (!session?.access_token) {
    setStatus(pricingStatus,'Sign in to an authorized Admin account before saving selling prices.',true);
    return;
  }
  if (centralPricingRevision === null) {
    setStatus(pricingStatus,'Reload central pricing to confirm the current revision before saving.',true);
    return;
  }
  if (!pricingForm.reportValidity()) {
    setStatus(pricingStatus,'Complete every selling rate with a valid non-negative price before saving.',true);
    return;
  }

  const config = makeSellingDefaults();
  for (const input of pricingForm.querySelectorAll('[name]')) {
    if (input.name === 'enduroShieldRate') config.enduroShieldRate = Number(input.value);
    else if (input.name.startsWith('rate.')) config.finalSellingRates[input.name.slice(5)] = Number(input.value);
  }
  const version = ++pricingLoadVersion;
  lockPricing(true);
  setStatus(pricingStatus,'Saving customer selling prices centrally...');
  try {
    const {pricing} = await callPricing('save',{config,expectedRevision:centralPricingRevision});
    if (version !== pricingLoadVersion || !adminSessionActive) return;
    if (!pricing) throw Error('The pricing service did not return the saved configuration. Reload central pricing to check its status.');
    pricingDraft = pricing.config;
    centralPricingRevision = pricing.revision;
    showPricingState('Saved',pricing);
    markPricingDraft(false);
    fillPricingSettings();
    const updated = pricing.updated_at ? new Date(pricing.updated_at).toLocaleString() : 'timestamp unavailable';
    setStatus(pricingStatus,`Central pricing \u2014 Saved. Revision ${pricing.revision}; updated ${updated}.`);
  } catch (error) {
    if (version === pricingLoadVersion) setStatus(pricingStatus,`${error.message} Your edits are still in the form; reload to confirm central status before retrying.`,true);
  } finally {
    if (version === pricingLoadVersion) lockPricing(!adminSessionActive);
  }
}

// Keep both explicit button clicks and implicit Enter-key form submits out of
// native HTML navigation. The submit listener is registered before auth startup.
pricingForm?.addEventListener('submit',savePricingSettings);
document.querySelector('#save-selling-prices')?.addEventListener('click',savePricingSettings);
document.querySelector('#reload-pricing-settings')?.addEventListener('click',loadCentralPricing);
document.querySelector('#reset-pricing-settings')?.addEventListener('click',() => {
  pricingDraft = makeSellingDefaults();
  fillPricingSettings();
  markPricingDraft(true);
  setStatus(pricingStatus,'Bruno’s confirmed rates loaded into the editor only. Save to publish centrally.');
});
pricingForm?.addEventListener('input',() => markPricingDraft(true));
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return 'Ã¢â‚¬â€';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return 'Ã¢â‚¬â€';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(Number(value));
}

function storedBaseEstimateLabel(quote) {
  if (quote.estimated_price !== null && quote.estimated_price !== undefined && quote.estimated_price !== '') {
    return formatMoney(quote.estimated_price);
  }
  if (quote.estimated_price_low !== null && quote.estimated_price_low !== undefined &&
      quote.estimated_price_high !== null && quote.estimated_price_high !== undefined) {
    return `${formatMoney(quote.estimated_price_low)}–${formatMoney(quote.estimated_price_high)}`;
  }
  return 'Not recorded';
}

function estimateLabel(quote) {
  const lowValue = quote.estimated_price_low ?? quote.estimated_price;
  const highValue = quote.estimated_price_high ?? quote.estimated_price;
  const low = Number(lowValue);
  const high = Number(highValue);
  if (lowValue === null || lowValue === undefined || lowValue === '' ||
      highValue === null || highValue === undefined || highValue === '' ||
      !Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high < low) return 'Not recorded';
  return `${formatMoney(low)}–${formatMoney(high + 150)}`;
}

function referralSourceLabel(quote) {
  const match = String(quote.message || '').match(/(?:^|\n\s*)Referral code:\s*(jeff|tony|hamy)\b/im);
  const names = {jeff:'Jeff', tony:'Tony', hamy:'Hamy'};
  return match ? `${names[match[1].toLowerCase()]} (from request message)` : 'Not provided';
}

async function callAdmin(action, payload = {}) {
  if (!supabaseClient?.auth) throw new Error('Admin authentication is unavailable. Reload the page and try again.');
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  const response = await fetch(ADMIN_FUNCTION_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ action, ...payload })
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'The admin request failed.');
  }
  return result;
}

function renderQuoteRows(items) {
  quotes.clear();
  items.forEach((quote) => quotes.set(String(quote.id), quote));
  quoteCount.textContent = String(items.length);
  emptyState.hidden = items.length > 0;
  quotesBody.innerHTML = items.map((quote) => `
    <tr data-quote-id="${escapeHtml(quote.id)}" class="${String(quote.id) === selectedQuoteId ? 'is-active' : ''}">
      <td>
        <div class="client-name">${escapeHtml(quote.name || 'Unnamed customer')}</div>
        <div class="client-meta">${escapeHtml(quote.tracking_number || 'Order number pending migration')} · ${escapeHtml(quote.email || quote.phone || 'No contact')}</div>
      </td>
      <td>${escapeHtml(quote.service || 'Ã¢â‚¬â€')}</td>
      <td class="table-muted">${escapeHtml(estimateLabel(quote))}</td>
      <td><span class="status-badge">${escapeHtml(quote.status || 'New')}</span></td>
      <td><button class="row-link" type="button" data-open-quote="${escapeHtml(quote.id)}">Open</button></td>
    </tr>
  `).join('');

  quotesBody.querySelectorAll('[data-open-quote]').forEach((button) => {
    button.addEventListener('click', () => openQuote(button.dataset.openQuote));
  });
}

function detailField(label, value, full = false, mono = false) {
  return `<div class="detail-field${full ? ' full' : ''}"><label>${label}</label><p class="detail-value${mono ? ' mono' : ''}">${escapeHtml(value ?? 'Ã¢â‚¬â€')}</p></div>`;
}

function renderDetail(quote) {
  const hasEstimate = quote.estimated_price_low !== null && quote.estimated_price_high !== null;
  const estimateMidpoint = hasEstimate
    ? (Number(quote.estimated_price_low) + Number(quote.estimated_price_high)) / 2
    : Number(quote.estimated_price || 0);
  const finalPrice = quote.final_price === null ? null : Number(quote.final_price);
  const finalDifference = finalPrice === null
    ? 'Pending final price'
    : hasEstimate ? formatMoney(finalPrice - estimateMidpoint) : 'No estimate saved';
  // Server-returned quote values are the only source for persisted status/pricing.
  ProjectWorkflow.dispose();
  detail.innerHTML = ProjectWorkflow.render(quote, {
    escapeHtml, formatMoney, formatDate, estimateLabel, storedBaseEstimateLabel, referralSourceLabel,
    supportedStatuses: [...BACKEND_STATUSES], finalDifference
  });
  ProjectWorkflow.mount(detail);
  if (quote.final_quote_sent_at && quote.final_price != null && quote.final_price !== '' && Number.isFinite(Number(quote.final_price))) {
    const pdfButton=document.createElement('button');pdfButton.type='button';pdfButton.className='button button-quiet';pdfButton.textContent='Print / Save Final Quote PDF';
    pdfButton.addEventListener('click',async()=>{
      const printWindow=window.open('about:blank','_blank');
      if(!printWindow){setStatus(crmStatus,'Allow the print window to open, then try again.',true);return;}
      try {
        const {createFinalQuoteDocument,renderFinalQuoteHtml}=await import('./quote-document.mjs');
        const documentData=createFinalQuoteDocument({quote,options:quote.options||[],photos:quote.photos||[],terms:quote.final_quote_terms||null});
        printWindow.document.open();printWindow.document.write(renderFinalQuoteHtml(documentData));printWindow.document.close();
        printWindow.setTimeout(()=>printWindow.print(),250);
        setStatus(crmStatus,'Final Quote print view opened. Use the browser print dialog to save a PDF. Email delivery is not configured.');
      } catch(error){printWindow.close();setStatus(crmStatus,error.message||'Final Quote PDF could not be prepared.',true);}
    });
    detail.prepend(pdfButton);
  }

  document.querySelector('#quote-status-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.querySelector('#quote-status').value;
    if (!BACKEND_STATUSES.has(status)) {
      setStatus(crmStatus, 'This status is not supported by the existing quote API.', true);
      return;
    }
    try {
      setStatus(crmStatus, 'Saving changes...');
      const result = await callAdmin('update', { id: quote.id, status });
      quotes.set(String(result.quote.id), result.quote);
      renderQuoteRows([...quotes.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      renderDetail({ ...quote, ...result.quote, photos: quote.photos });
      setStatus(crmStatus, 'Quote updated.');
    } catch (error) {
      setStatus(crmStatus, error.message, true);
    }
  });

  const draftForm = detail.querySelector('#final-quote-form');
  draftForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {id:quote.id,finalPrice:Number(form.elements.finalPrice.value),scope:form.elements.scope.value,quoteDate:form.elements.quoteDate.value,expiresAt:form.elements.expiresAt.value||null};
    const status = form.querySelector('.wf-action-status');
    try { status.textContent='Saving unpublished Final Quote draft…'; const result=await callAdmin('save-final-quote-draft',payload); quotes.set(String(quote.id),result.quote); renderDetail({...quote,...result.quote,photos:quote.photos}); setStatus(crmStatus,'Final Quote draft saved. It is not visible to the customer.'); }
    catch(error){status.textContent=error.message;}
  });
  draftForm?.querySelector('[data-publish]')?.addEventListener('click',async event=>{
    const form=draftForm, status=form.querySelector('.wf-action-status');
    if(!form.reportValidity())return;
    const payload={id:quote.id,finalPrice:Number(form.elements.finalPrice.value),scope:form.elements.scope.value,quoteDate:form.elements.quoteDate.value,expiresAt:form.elements.expiresAt.value||null};
    try { status.textContent='Saving draft before publication…'; await callAdmin('save-final-quote-draft',payload); if(!window.confirm('Publish this Final Quote to the customer tracking page?')){status.textContent='Draft saved. Nothing was published.';return;} status.textContent='Publishing Final Quote…'; const result=await callAdmin('publish-final-quote',{id:quote.id}); quotes.set(String(quote.id),result.quote); renderDetail({...quote,...result.quote,photos:quote.photos}); setStatus(crmStatus,'Final Quote published to secure customer tracking.'); }
    catch(error){status.textContent=error.message;}
  });
  detail.querySelector('#project-workflow-form')?.addEventListener('submit',async event=>{
    event.preventDefault(); const form=event.currentTarget,status=detail.querySelector('#project-workflow-form').parentElement.querySelector('.wf-action-status');
    try {
      const photoPaths={measurement:[...(quote.measurement_photo_paths||[])],installation:[...(quote.installation_photo_paths||[])]};
      for(const stage of ['measurement','installation']) { const files=[...form.elements[stage==='measurement'?'measurementPhotos':'installationPhotos'].files]; if(!files.length)continue; const uploads=await callAdmin('prepare-workflow-uploads',{id:quote.id,stage,files:files.map(file=>({name:file.name,size:file.size,type:file.type}))}); for(const [i,item] of uploads.uploads.entries()){const {error}=await supabaseClient.storage.from('quote-photos').uploadToSignedUrl(item.path,item.token,files[i]);if(error)throw error;photoPaths[stage].push(item.path);} }
      const data={id:quote.id,projectStatus:form.elements.projectStatus.value,technician:form.elements.technician.value,verifiedWidth:form.elements.verifiedWidth.value,verifiedHeight:form.elements.verifiedHeight.value,measurementCompleted:form.elements.measurementCompleted.checked,technicianNotes:form.elements.technicianNotes.value,installer:form.elements.installer.value,installationScheduledAt:form.elements.installationScheduledAt.value||null,installerNotes:form.elements.installerNotes.value,paymentDate:form.elements.paymentDate.value||null,measurementPhotoPaths:photoPaths.measurement,installationPhotoPaths:photoPaths.installation};
      if(form.elements.installationStatus.value!=='')data.installationStatus=form.elements.installationStatus.value;
      if(form.elements.amountPaid.value.trim()!=='')data.amountPaid=Number(form.elements.amountPaid.value);
      status.textContent='Saving project updates…';await callAdmin('update-project-workflow',data);const fresh=await callAdmin('get',{id:quote.id});quotes.set(String(quote.id),fresh.quote);renderDetail(fresh.quote);setStatus(crmStatus,'Project workflow updated.');
    } catch(error){status.textContent=error.message;}
  });
}

async function openQuote(id) {
  selectedQuoteId = String(id);
  try {
    setStatus(crmStatus, 'Loading quote...');
    const result = await callAdmin('get', { id });
    renderDetail(result.quote);
    renderQuoteRows([...quotes.values()]);
    setStatus(crmStatus, '');
  } catch (error) {
    setStatus(crmStatus, error.message, true);
  }
}

async function loadQuotes({ background = false } = {}) {
  if (!adminSessionActive) return;
  const version = ++quoteLoadVersion;
  try {
    if (!background) setStatus(crmStatus, 'Loading quotes...');
    const result = await callAdmin('list');
    if (version !== quoteLoadVersion || !adminSessionActive) return;
    if (!Array.isArray(result.quotes)) {
      throw new Error('The quote API returned an unexpected response. Expected a quotes array.');
    }
    const items = [...result.quotes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    renderQuoteRows(items);
    setStatus(crmStatus, items.length ? '' : 'The quote API returned no records. Use Refresh to check again.');
  } catch (error) {
    if (version !== quoteLoadVersion || !adminSessionActive) return;
    setStatus(crmStatus, error.message, true);
  }
}

async function showCrm(session) {
  adminSessionActive = Boolean(session);
  loginPanel.hidden = Boolean(session);
  crmPanel.hidden = !session;
  if (session) { await loadQuotes(); if (centralPricingRevision === null) await loadCentralPricing(); }
  else {
    quoteLoadVersion++;
    pricingLoadVersion++; centralPricingRevision = null; pricingDraft = makeSellingDefaults();
    fillPricingSettings(); pricingForm.querySelectorAll("input,button").forEach(x => x.disabled = true);
    showPricingState('Sign in to load'); markPricingDraft(false);
    setStatus(pricingStatus,'Sign in to load central pricing.');
    quoteCount.textContent = '0';
    emptyState.hidden = true;
    ProjectWorkflow.dispose();
    detail.replaceChildren();
    quotes.clear();
    quotesBody.replaceChildren();
    selectedQuoteId = null;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabaseClient?.auth) {
    setStatus(loginStatus,'Admin authentication could not initialize. Reload the page and try again.',true);
    return;
  }
  setStatus(loginStatus, 'Signing in...');
  const email = document.querySelector('#login-email').value.trim();
  const password = document.querySelector('#login-password').value;
  try {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus(loginStatus, error.message, true);
      return;
    }
    loginForm.reset();
    setStatus(loginStatus, '');
  } catch (error) {
    setStatus(loginStatus,`Sign-in failed: ${error.message}`,true);
  }
});

document.querySelector('#sign-out').addEventListener('click', async () => {
  if (!supabaseClient?.auth) {
    setStatus(loginStatus,'Admin authentication is unavailable. Reload the page and try again.',true);
    return;
  }
  await supabaseClient.auth.signOut();
});
document.querySelector('#refresh-quotes').addEventListener('click', loadQuotes);
window.addEventListener('focus', () => loadQuotes({ background: true }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadQuotes({ background: true });
});
setInterval(() => {
  if (document.visibilityState === 'visible') loadQuotes({ background: true });
}, 30000);
if (supabaseClient?.auth) {
  // Register handlers before starting async auth work. Pricing form prevention
  // is already active if session lookup later fails.
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => showCrm(session), 0);
  });
  supabaseClient.auth.getSession()
    .then(({ data: { session } }) => showCrm(session))
    .catch(error => {
      console.error('Admin session initialization failed.',error);
      loginPanel.hidden = false;
      crmPanel.hidden = true;
      setStatus(loginStatus,`Could not check your sign-in session: ${error.message}. Reload and sign in again.`,true);
      setStatus(pricingStatus,'Admin sign-in could not be verified. No pricing changes can be saved.',true);
    });
} else {
  loginPanel.hidden = false;
  crmPanel.hidden = true;
  setStatus(loginStatus,'Admin authentication could not initialize. Reload the page and try again.',true);
  setStatus(pricingStatus,'Admin authentication could not initialize. No pricing changes can be saved.',true);
}
