// Renderer-neutral data only. No PDF generation, storage, issuance, or delivery.
// Final documents must be built by an authorized server from a trusted Admin record.
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const money = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const date = value => text(value) && Number.isFinite(Date.parse(value)) ? value : null;
const range = (low, high) => low != null && high != null && high >= low ? {low, high} : null;
const branding = Object.freeze({name:"Bruno's Glass & Mirror", logoAsset:'images/brunos-glass-mirror-logo.png', officeEmail:'office@brunosglass.com', phone:'+1 954 224 4254'});
export const PRELIMINARY_DISCLAIMER = 'PRELIMINARY ESTIMATE — subject to professional review and field measurement. Not a Final Quote, fabrication authorization, or payment receipt.';

function common({quote = {}, pricingRevision = null, dimensions = {}, options = [], photos = [], preparedAt = null, terms = null} = {}) {
  return {
    schemaVersion:1, branding:{...branding},
    orderNumber:text(quote.tracking_number), quoteNumber:text(quote.quote_number),
    customer:{name:text(quote.name), phone:text(quote.phone), email:text(quote.email), address:text(quote.installation_address), city:text(quote.city)},
    project:{type:text(quote.service), configuration:text(quote.product) || text(quote.door_type), material:text(quote.glass_type),
      options:options.filter(option => typeof option === 'string').map(option => option.trim()).filter(Boolean),
      measurements:{width:text(dimensions.widthText) || (quote.width == null ? null : String(quote.width)),
        height:text(dimensions.heightText) || (quote.height == null ? null : String(quote.height)), unit:'in', approximate:true},
      squareFeet:money(quote.square_feet), quantity:Number.isSafeInteger(quote.quantity) && quote.quantity > 0 ? quote.quantity : null,
      photos:photos.filter(photo => photo && typeof photo === 'object').map(photo => ({name:text(photo.name),
        storagePath:typeof photo.storagePath === 'string' && /^quotes\/[A-Za-z0-9_/-]+\.[A-Za-z0-9]+$/.test(photo.storagePath) ? photo.storagePath : null,
        caption:text(photo.caption)})), notes:text(quote.message)},
    dates:{requestedAt:date(quote.created_at), preparedAt:date(preparedAt)},
    pricingRevision:Number.isSafeInteger(pricingRevision) && pricingRevision >= 0 ? pricingRevision : null,
    terms:text(terms), delivery:{pdfGenerated:false, emailSent:false}
  };
}
export function createPreliminaryDocument(input = {}) {
  const quote = input.quote || {};
  const base = range(money(quote.estimated_price_low), money(quote.estimated_price_high));
  return {...common(input), kind:'preliminary-estimate', title:'Preliminary Estimate', authoritative:false,
    disclaimer:PRELIMINARY_DISCLAIMER,
    pricing:{baseEstimate:base, customerEstimateRange:base ? {low:base.low, high:base.high + 150} : null,
      estimatedDeposit:base ? {low:base.low * .5, high:base.high * .5} : null,
      finalPrice:null, finalApprovedPrice:null, finalDeposit:null,
      note:'Customer range adds $150 to the upper base estimate for planning. Estimated deposit uses the base estimate. Final pricing and deposit require Bruno Admin review.'}};
}
export function createFinalQuoteDocument(input = {}) {
  const quote = input.quote || {};
  const finalPrice = money(quote.final_price);
  if (!date(quote.final_quote_sent_at) || finalPrice == null) throw Error('A published Admin Final Quote with a valid final price is required.');
  const document = common(input);
  const verified = Boolean(date(quote.measurement_completed_at) && text(quote.verified_width) && text(quote.verified_height));
  if (verified) document.project.measurements = {width:quote.verified_width, height:quote.verified_height, unit:'in', approximate:false, verifiedAt:quote.measurement_completed_at};
  return {...document, kind:'admin-final-quote', title:'Bruno Admin Final Quote', authoritative:true,
    disclaimer:'Bruno Admin Final Quote. Only the published scope, price and terms apply. This document does not verify payment or authorize fabrication by itself.',
    scope:text(quote.final_quote_scope),
    dates:{...document.dates, quoteDate:date(quote.final_quote_date), expiresAt:date(quote.final_quote_expires_at), publishedAt:quote.final_quote_sent_at, acceptedAt:date(quote.final_quote_accepted_at)},
    pricing:{baseEstimate:null, customerEstimateRange:null, estimatedDeposit:null, finalPrice,
      finalApprovedPrice:date(quote.final_quote_accepted_at) ? finalPrice : null, finalDeposit:finalPrice * .5}};
}

const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const documentMoney=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
export function renderFinalQuoteHtml(document) {
  if(document?.kind!=='admin-final-quote'||document.authoritative!==true||!Number.isFinite(document.pricing?.finalPrice)) throw Error('A published Admin Final Quote is required for the PDF print view.');
  const rows=[['Project',document.project.type],['Configuration',document.project.configuration],['Material',document.project.material],['Measurements',document.project.measurements.width&&document.project.measurements.height?`${document.project.measurements.width} × ${document.project.measurements.height} in${document.project.measurements.approximate?' (customer-entered approximate)':' (field verified)'}`:null],['Options',document.project.options.join(', ')||null]].filter(([,value])=>value);
  const price=document.pricing.finalPrice,deposit=document.pricing.finalDeposit;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Final Quote ${htmlEscape(document.orderNumber||'')}</title><style>
    @page{size:letter;margin:0.65in}*{box-sizing:border-box}body{font:14px/1.55 Arial,sans-serif;color:#182b42;margin:0}.sheet{max-width:7.2in;margin:0 auto}.brand{border-bottom:3px solid #09264c;padding:0 0 16px;margin-bottom:26px}.brand h1{font-size:25px;margin:0;color:#09264c}.brand p{margin:5px 0;color:#52657b}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:10px;color:#61748a;font-weight:bold}.heading{display:flex;justify-content:space-between;gap:20px;align-items:start}.heading h2{font-size:27px;margin:2px 0 14px}.order{font-weight:bold;color:#09264c}.columns{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin:20px 0}.card{border:1px solid #d8e0e8;padding:14px 16px;break-inside:avoid}.card h3{font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 10px;color:#52657b}.card p{margin:3px 0;overflow-wrap:anywhere}.scope{white-space:pre-wrap}.line{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid #d8e0e8}.total{font-size:22px;font-weight:bold;color:#09264c}.note{font-size:11px;color:#52657b}.footer{margin-top:28px;padding-top:12px;border-top:1px solid #d8e0e8;font-size:11px;color:#52657b}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.sheet{max-width:none}}
  </style></head><body><main class="sheet"><header class="brand"><p class="eyebrow">${htmlEscape(document.branding.name)}</p><h1>Final Project Quote</h1><p>${htmlEscape(document.branding.phone)} · ${htmlEscape(document.branding.officeEmail)}</p></header><div class="heading"><div><p class="eyebrow">Prepared for</p><h2>${htmlEscape(document.customer.name||'Customer')}</h2></div><div class="order">Order ${htmlEscape(document.orderNumber||'Pending')}</div></div><section class="columns"><div class="card"><h3>Customer</h3><p>${htmlEscape(document.customer.email||'')}</p><p>${htmlEscape(document.customer.phone||'')}</p><p>${htmlEscape([document.customer.address,document.customer.city].filter(Boolean).join(', '))}</p></div><div class="card"><h3>Project</h3>${rows.map(([label,value])=>`<p><strong>${htmlEscape(label)}:</strong> ${htmlEscape(value)}</p>`).join('')}</div></section><section class="card"><h3>Final scope</h3><p class="scope">${htmlEscape(document.scope||'')}</p></section><section class="card" style="margin-top:18px"><h3>Price and payment schedule</h3><div class="line"><span>Final quoted price</span><strong>${documentMoney(price)}</strong></div><div class="line"><span>Deposit required to commence (50%)</span><strong>${documentMoney(deposit)}</strong></div><div class="line"><span>Remaining balance after deposit</span><strong>${documentMoney(Math.max(0,price-deposit))}</strong></div><p class="note">A payment receipt is issued separately after payment is received and verified.</p></section>${document.terms?`<section class="card" style="margin-top:18px"><h3>Terms</h3><p class="scope">${htmlEscape(document.terms)}</p></section>`:''}<footer class="footer">${htmlEscape(document.disclaimer)}<br>Quote date: ${htmlEscape(document.dates.quoteDate||'')} · Expires: ${htmlEscape(document.dates.expiresAt||'Not specified')}</footer></main></body></html>`;
}
