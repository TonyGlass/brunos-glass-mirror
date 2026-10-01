/* Admin-rendered project workspace. Persistence requests are made by the authenticated Admin controller. */
window.ProjectWorkflow = (() => {
  const stages = ['Quote Requested','Estimate Provided','Deposit Received','Measurement Scheduled','Measurements Verified','Final Quote Preparing','Final Quote Ready','Final Quote Accepted','Fabrication','Ready for Installation','Installation Scheduled','Installation In Progress','Installation Completed','Final Payment Due','Paid','Completed'];
  let urls = [];
  let controller;
  function dispose() {
    controller?.abort();
    urls.forEach(url => URL.revokeObjectURL(url));
    urls = [];
  }
  function measurement(value) {
    if (value === null || value === undefined || value === '') return 'Not recorded';
    // Preserve any original text verbatim. Never round non-sixteenth values.
    if (typeof value === 'string') return value + ' in';
    if (!Number.isFinite(value)) return 'Not recorded';
    const ticks = value * 16;
    if (!Number.isSafeInteger(ticks) || value < 0) return String(value) + ' in (stored value)';
    const whole = Math.floor(ticks / 16);
    let numerator = ticks % 16, denominator = 16;
    if (!numerator) return `${whole} in`;
    while (numerator % 2 === 0) { numerator /= 2; denominator /= 2; }
    return `${whole ? whole + ' ' : ''}${numerator}/${denominator} in`;
  }
  function safeUrl(value) {
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; }
    catch { return ''; }
  }
  function render(quote, helpers) {
    const { escapeHtml: e, formatMoney: money, formatDate: date, estimateLabel, storedBaseEstimateLabel, referralSourceLabel, supportedStatuses, finalDifference } = helpers;
    const missing = 'Not available in the current quote record';
    const field = (label, value) => `<div class="wf-field"><dt>${e(label)}</dt><dd>${e(value === null || value === undefined || value === '' ? 'Not recorded' : value)}</dd></div>`;
    const group = (title, content) => `<section class="wf-card"><h3>${e(title)}</h3><dl class="wf-grid">${content}</dl></section>`;
    const input = (label, name, type = 'text', placeholder = '') => `<label class="wf-input">${e(label)}<input name="${e(name)}" type="${type}" placeholder="${e(placeholder)}" autocomplete="off" /></label>`;
    const note = (label, name) => `<label class="wf-input wf-wide">${e(label)}<textarea name="${e(name)}" rows="3"></textarea></label>`;
    const canonicalStatus = stages.find(s => s.toLowerCase() === String(quote.project_status || '').toLowerCase());
    const status = canonicalStatus || (quote.project_status == null ? 'Stage not assigned (pre-migration)' : quote.project_status);
    const apiStatus = supportedStatuses.find(s => s.toLowerCase() === String(quote.status).toLowerCase());
    const statusOptions = (!apiStatus ? '<option value="" selected disabled>Select a supported status</option>' : '') + supportedStatuses.map(s => `<option value="${e(s)}" ${s === apiStatus ? 'selected' : ''}>${e(s)}</option>`).join('');
    const glass = String(quote.glass_type || '');
    const thickness = glass.match(/ - (\d+\/\d+)$/)?.[1];
    const customer = field('Customer', quote.name) + field('Phone', quote.phone) + field('Email', quote.email) + field('City', quote.city) + field('Referral source (from request message)', referralSourceLabel(quote)) + field('Installation address', quote.installation_address);
    const project = field('Project order', quote.tracking_number) + field('Service', quote.service) + field('Model', quote.product) + field('Door / enclosure', quote.door_type) + field('Quantity', quote.quantity);
    const specs = field('Glass specification', quote.glass_type) + field('Thickness (from specification)', thickness ? thickness + ' in' : null) + field('Glass type / finish', glass ? glass.replace(/ - \d+\/\d+$/, '') : null) + field('Glass color',missing) + field('Hinges',missing) + field('Clips',missing) + field('Sweeps',missing) + field('Hardware finish', quote.hardware_finish) + field('Handle style', quote.handle_style) + field('Hinges, clips, sweeps and other counts', 'See the original request notes; structured counts are not provided by the API.');
    const dimensions = field('Width', measurement(quote.width)) + field('Height', measurement(quote.height)) + field('Square feet', quote.square_feet) + field('Door size / deductions', missing);
    const media = (quote.photos || []).map(photo => {
      const url = safeUrl(photo.signedUrl);
      if (!url) return '';
      const video = /\.(mp4|webm|mov)$/i.test(photo.path || '');
      const stageLabel = photo.stage === 'measurement' ? 'Technician measurement photo' : photo.stage === 'installation' ? 'Installer photo' : video ? 'Customer video' : 'Customer project photo';
      return `<figure>${video ? `<video controls preload="metadata" src="${e(url)}" aria-label="${e(stageLabel)}"></video>` : `<a href="${e(url)}" target="_blank" rel="noopener"><img src="${e(url)}" alt="${e(stageLabel)}" loading="lazy" /></a>`}<figcaption>${e(stageLabel)} <a href="${e(url)}" target="_blank" rel="noopener">Open original</a></figcaption></figure>`;
    }).join('');
    const photos = `<section class="wf-card"><h3>Customer photos &amp; videos</h3>${media ? `<div class="wf-media">${media}</div>` : '<p>No attachments available.</p>'}</section>`;
    const preview = '<p class="wf-notice">Presentation only. Entries and selected photos stay in this view and are discarded when you reopen a quote, refresh, or sign out. Nothing is saved or uploaded.</p>';
    const tabs = [['review','Review'],['quote','Quote & deposit'],['formal','Formal Quote'],['work','Work Order preview'],['schedule','Scheduling'],['completion','Completion Photos & Notes'],['history','History']];
    return `<div class="wf-project">
      <header class="detail-header"><div><p class="section-kicker">Quote / project review</p><h3>${e(quote.name || 'Customer name not recorded')}</h3><p class="detail-email">${e(quote.email || '')}</p><p class="wf-id">${e(quote.tracking_number || 'Tracking number pending migration')}</p></div><span class="status-badge">${e(status)}</span></header>
      <div class="detail-actions"><a class="button contact-button" href="sms:${e(String(quote.phone || '').replace(/[^+\d]/g,''))}">Text Customer</a><a class="button contact-button" href="mailto:${encodeURIComponent(quote.email || '')}">Email Customer</a></div>
      <section class="wf-lifecycle" aria-label="Project lifecycle"><ol>${stages.map((s,i) => `<li ${s===canonicalStatus ? 'aria-current="step" class="is-current"' : ''}><span>${i+1}</span><strong>${e(s)}</strong></li>`).join('')}</ol><p>${canonicalStatus ? 'Current recorded status only. Earlier stages are not evidence of completed approvals or payments.' : 'No project stage is assigned to this historical record. Admin must select a verified stage before saving project updates.'}</p></section>
      <div class="wf-tabs" role="tablist" aria-label="Project views">${tabs.map(([id,label],i)=>`<button type="button" role="tab" id="wf-tab-${id}" aria-controls="wf-panel-${id}" aria-selected="${i===0}" tabindex="${i===0?0:-1}" data-workflow-tab="${id}">${label}</button>`).join('')}</div>
      <section id="wf-panel-review" role="tabpanel" aria-labelledby="wf-tab-review" tabindex="0">${group('Customer',customer)}${group('Project & model',project)}${group('Glass & hardware',specs)}${group('Customer measurements',dimensions)}<p class="wf-note">Customer dimensions are approximate, not verified field measurements. Numeric values are shown as exact fractions only when representable without rounding.</p>${group('Verified field measurements',field('Verified width',measurement(quote.verified_width))+field('Verified height',measurement(quote.verified_height))+field('Completed',quote.measurement_completed_at ? date(quote.measurement_completed_at) : 'Not completed')+field('Assigned technician',quote.assigned_technician)+field('Assigned installer',quote.assigned_installer)+field('Installation status',quote.installation_status)+field('Scheduled installation',quote.installation_scheduled_at ? date(quote.installation_scheduled_at) : 'Not scheduled'))}${group('Technician / installer notes (Admin only)',field('Technician notes',quote.technician_notes)+field('Installer notes',quote.installer_notes))}${group('Original request & notes',field('Customer message / hardware summary',quote.message))}${photos}</section>
      <section id="wf-panel-quote" role="tabpanel" aria-labelledby="wf-tab-quote" tabindex="0" hidden>
      ${group('Quote summary',field('Stored base estimate',storedBaseEstimateLabel(quote))+field('Customer display range (derived, not saved)',estimateLabel(quote))+field('Central estimate low (saved)',money(quote.estimated_price_low))+field('Central estimate high (saved)',money(quote.estimated_price_high))+field('Final project price',money(quote.final_price))+field('Difference from estimate midpoint',finalDifference)+field('Installation / taxes / fees breakdown',missing)+field('Formal quote number / payment terms',missing))}<p class="wf-note">The customer display range adds $150 to the existing central estimate's upper end. The stored estimate and pricing calculation are unchanged.</p>
      ${group('Deposit & approval',field('Required to commence',quote.final_price == null ? 'Pending published Final Quote' : money(Number(quote.final_price)*0.5))+field('Deposit terms','50% of Bruno’s published Final Quote; this Admin records payments received and does not process charges.')+field('Payments received',quote.amount_paid == null ? 'Unknown (legacy record)' : money(quote.amount_paid))+field('Payment date',quote.payment_date)+field('Payment verified',quote.payment_verified_at ? date(quote.payment_verified_at) : 'Not recorded')+field('Actual remaining balance',quote.final_price == null ? 'Pending published Final Quote' : quote.amount_paid == null ? 'Unknown until verified' : money(Math.max(0,Number(quote.final_price)-Number(quote.amount_paid))))+field('Customer approval',quote.final_quote_accepted_at ? date(quote.final_quote_accepted_at) : 'Awaiting customer approval'))}
      <p class="wf-notice">Payment records are entered by Admin after receipt. The site does not charge customers. Fabrication and installation require the published Final Quote and a verified 50% payment.</p>
      <form class="wf-card" id="final-quote-form"><h3>Admin Final Quote</h3><p>Only Bruno/Admin can edit this draft. The customer cannot see it until Publish is selected.</p>${quote.final_quote_sent_at ? `<p><strong>Published ${e(date(quote.final_quote_sent_at))} · ${e(money(quote.final_price))}</strong></p>${field('Published scope',quote.final_quote_scope)}${field('Accepted',quote.final_quote_accepted_at ? date(quote.final_quote_accepted_at) : 'Awaiting customer approval')}` : `<div class="wf-grid"><label class="wf-input">Final project price<input name="finalPrice" type="number" min="0" step="0.01" required value="${e(quote.final_quote_draft_price ?? '')}" /></label><label class="wf-input">Quote date<input name="quoteDate" type="date" required value="${e(quote.final_quote_draft_date || new Date().toISOString().slice(0,10))}" /></label><label class="wf-input">Expiration date (optional)<input name="expiresAt" type="date" value="${e(quote.final_quote_draft_expires_at || '')}" /></label><label class="wf-input wf-wide">Customer-facing scope / notes (shown to customer when published)<textarea name="scope" rows="5" required>${e(quote.final_quote_draft_scope || '')}</textarea></label></div><p><button class="button button-quiet" type="submit" data-draft>Save Draft</button> <button class="button button-accent" type="button" data-publish>Publish Final Quote</button></p>`}<p class="wf-action-status" role="status"></p></form>
      <section class="wf-card"><h3>Project operations</h3><p>Admin-only workflow. Technician and installer notes are never returned by customer tracking.</p><form id="project-workflow-form"><div class="wf-grid"><label class="wf-input">Project status<select name="projectStatus" required>${quote.project_status == null ? '<option value="" selected disabled>Stage not assigned (pre-migration) - choose a verified stage</option>' : ''}${['Quote Requested','Estimate Provided','Deposit Received','Measurement Scheduled','Measurements Verified','Final Quote Preparing','Final Quote Ready','Final Quote Accepted','Fabrication','Ready for Installation','Installation Scheduled','Installation In Progress','Installation Completed','Final Payment Due','Paid','Completed'].map(x=>`<option ${x===quote.project_status?'selected':''}>${x}</option>`).join('')}</select></label><label class="wf-input">Measurement technician<input name="technician" value="${e(quote.assigned_technician||'')}" /></label><label class="wf-input">Verified width (in)<input name="verifiedWidth" value="${e(quote.verified_width||'')}" /></label><label class="wf-input">Verified height (in)<input name="verifiedHeight" value="${e(quote.verified_height||'')}" /></label><label class="wf-input">Installer<input name="installer" value="${e(quote.assigned_installer||'')}" /></label><label class="wf-input">Installation status<select name="installationStatus">${quote.installation_status == null ? '<option value="" selected>Not assigned (choose when known)</option>' : ''}${['Not Started','Scheduled','Installation In Progress','Installation Completed'].map(x=>`<option ${x===quote.installation_status?'selected':''}>${x}</option>`).join('')}</select></label><label class="wf-input">Installation date<input name="installationScheduledAt" type="date" value="${e(quote.installation_scheduled_at?.slice(0,10)||'')}" /></label><label class="wf-input">Verified payments received<input name="amountPaid" type="number" min="0" step="0.01" value="${e(quote.amount_paid ?? '')}" /></label><label class="wf-input">Payment date<input name="paymentDate" type="date" value="${e(quote.payment_date||'')}" /></label><label class="wf-input wf-wide"><span><input type="checkbox" name="measurementCompleted" ${quote.measurement_completed_at?'checked':''}/> Measurements completed and verified</span></label><label class="wf-input wf-wide">Technician notes (internal)<textarea name="technicianNotes" rows="3">${e(quote.technician_notes||'')}</textarea></label><label class="wf-input wf-wide">Installer notes (internal)<textarea name="installerNotes" rows="3">${e(quote.installer_notes||'')}</textarea></label><label class="wf-input">Measurement photos<input type="file" name="measurementPhotos" accept="image/jpeg,image/png,image/webp" multiple /></label><label class="wf-input">Installation photos<input type="file" name="installationPhotos" accept="image/jpeg,image/png,image/webp" multiple /></label></div><button class="button button-accent" type="submit">Save Project Updates</button></form><p class="wf-action-status" role="status"></p></section></section>
      <section id="wf-panel-formal" role="tabpanel" aria-labelledby="wf-tab-formal" tabindex="0" hidden>
      <article class="wf-formal"><header class="wf-sheet-header"><img class="wf-formal-logo" src="images/brunos-glass-mirror-logo.png" alt="Bruno's Glass &amp; Mirror" /><h2>Formal Quote</h2><span class="wf-preview-badge">Draft preview - not issued</span></header>
      <p class="wf-notice">Separate from the automatic estimate. Document issuance, customer approval and delivery are not connected.</p>
      ${group('Document',field('Quote number',quote.tracking_number)+field('Source request',quote.tracking_number)+field('Quote date',quote.final_quote_date)+field('Expiration date',quote.final_quote_expires_at))}
      ${group('Customer',customer)}${group('Project items',project)}${group('Glass specifications & hardware',specs)}${group('Measurements',dimensions)}
      ${group('Price & terms',field('Installation',missing)+field('Taxes / fees when applicable',missing)+field('Total',money(quote.final_price))+field('50% deposit required',quote.final_price == null ? 'Pending final price' : money(Number(quote.final_price)*0.5))+field('Balance after required deposit (not actual balance due)',quote.final_price == null ? 'Pending final price' : money(Number(quote.final_price)*0.5))+field('Actual remaining balance','Unavailable until payments are verified')+field('Terms',missing)+field('Customer approval status','Approval evidence unavailable'))}
      </article></section>
      <form class="workspace-form" id="workspace-form">
      <section id="wf-panel-work" role="tabpanel" aria-labelledby="wf-tab-work" tabindex="0" hidden>
      <header class="wf-sheet-header"><p class="section-kicker">Bruno's Glass &amp; Mirror</p><h2>Installation Work Order</h2><span class="wf-preview-badge">Preview only - not issued</span></header>
      <p class="wf-notice">Not authorized for installation. Verified deposit, installation address, field measurements, and scheduling information are unavailable. This preview cannot issue a Work Order.</p>
      <button class="button button-quiet" type="button" data-field-view aria-pressed="false">Focus field view</button>
      ${group('Customer & site',customer)}${group('Project',project+field('Work Order #',missing)+field('Recorded status',status)+field('Scheduled installation',missing))}${group('Product specifications',specs)}${group('Customer measurements - verify on site',dimensions)}${group('Customer notes',field('Original request',quote.message))}${photos}
      <section class="wf-card"><h3>Installer Notes / Field Measurements / Corrections</h3>${preview}<div class="wf-grid">
      ${input('Exact field width (inches)','field_width','text','e.g. 60 1/16')}${input('Exact field height (inches)','field_height','text','e.g. 72 1/8')}${input('Door size (exact text)','door_size')}${input('Panel size (exact text)','panel_size','text','e.g. 24 1/4')}${input('Special deductions (exact text)','special_deductions')}${note('Measurement notes / corrections','measurement_notes')}${note('Installation instructions','installation_instructions')}${note('Special instructions','special_instructions')}${note('Project notes','bruno_notes')}${note('Installation observations','installation_observations')}${note('Material differences','material_differences')}${note('Access / site conditions','site_conditions')}${note('Additional notes','notes')}
      </div><p class="wf-note">Measurement text is retained exactly as typed in this preview. It does not replace the saved customer dimensions.</p><button class="button button-dark" type="button" disabled>Issue Work Order - unavailable</button></section></section>
      <section id="wf-panel-schedule" role="tabpanel" aria-labelledby="wf-tab-schedule" tabindex="0" hidden><section class="wf-card"><h3>Installation scheduling</h3>${preview}<p>Scheduling eligibility is unknown until the required deposit is verified.</p><div class="wf-grid">${input('Proposed installation date','installation_date','date')}${input('Installer','installer_name')}${note('Schedule notes','schedule_notes')}</div><button class="button button-dark" type="button" disabled>Confirm schedule - unavailable</button></section></section>
      <section id="wf-panel-completion" role="tabpanel" aria-labelledby="wf-tab-completion" tabindex="0" hidden><section class="wf-card"><h3>Completion Photos &amp; Notes</h3>${preview}<div class="wf-grid"><label class="wf-input wf-wide">Final installation photos<input name="final_photos" type="file" accept="image/jpeg,image/png,image/webp" multiple /><small>Local previews only. Customer attachments remain separate.</small></label><p class="wf-upload-status wf-wide" role="status"></p><div class="wf-media wf-wide" data-final-previews></div>${note('Final installer notes','final_installer_notes')}${note('Work performed / installer observations','final_observations')}${note('Problems encountered / damage','problems')}${note('Corrections required','corrections_required')}${note('Measurements changed in field','field_changes')}${note('Materials changed','materials_changed')}${note('Hardware changed','hardware_changed')}${note('Customer observations','customer_observations')}${note('Additional work requested','extra_work')}${input('Completion date','completed_date','date')}<label class="wf-input">Recorded project status<input value="${e(status)}" readonly /></label></div><button class="button button-dark" type="button" disabled>MARK INSTALLATION COMPLETE</button><button class="button button-quiet" type="button" data-clear-photos>Clear photo previews</button></section></section>
      </form>
      <section id="wf-panel-history" role="tabpanel" aria-labelledby="wf-tab-history" tabindex="0" hidden>${group('Available project history',field('Quote created',quote.created_at ? date(quote.created_at) : null)+field('Current recorded status',status)+field('Transitions / responsible user',missing))}<p class="wf-notice">No approval, payment, installation, or completion history is supplied by the current API. Timeline dates and responsible users are not inferred.</p></section>
      <p class="wf-preview-status" role="status"></p>
    </div>`;
  }
  function mount(root) {
    controller = new AbortController();
    const on = (el,event,fn) => el?.addEventListener(event,fn,{signal:controller.signal});
    const tabs = [...root.querySelectorAll('[data-workflow-tab]')];
    function select(tab) {
      tabs.forEach(t => {const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;root.querySelector('#'+t.getAttribute('aria-controls')).hidden=!active;});
      if (tab.dataset.workflowTab !== 'work') {root.closest('.crm-panel').classList.remove('is-field-view');root.querySelector('[data-field-view]').setAttribute('aria-pressed','false');root.querySelector('[data-field-view]').textContent='Focus field view';}
    }
    tabs.forEach((tab,i) => {
      on(tab,'click',()=>select(tab));
      on(tab,'keydown',event=>{
        let next;
        if(event.key==='ArrowRight')next=(i+1)%tabs.length;
        if(event.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;
        if(event.key==='Home')next=0;
        if(event.key==='End')next=tabs.length-1;
        if(next!==undefined){event.preventDefault();select(tabs[next]);tabs[next].focus();}
      });
    });
    on(root.querySelector('#workspace-form'),'submit',event=>{event.preventDefault();root.querySelector('.wf-preview-status').textContent='Preview only. Nothing was saved or uploaded.';});
    on(root.querySelector('[data-field-view]'),'click',event=>{
      const active=root.closest('.crm-panel').classList.toggle('is-field-view');event.currentTarget.setAttribute('aria-pressed',String(active));event.currentTarget.textContent=active?'Exit field view':'Focus field view';
    });
    const files=root.querySelector('[name="final_photos"]'), grid=root.querySelector('[data-final-previews]'), status=root.querySelector('.wf-upload-status');
    function clear(){urls.forEach(u=>URL.revokeObjectURL(u));urls=[];grid.replaceChildren();files.value='';status.textContent='Photo previews cleared. Nothing was uploaded.';}
    on(root.querySelector('[data-clear-photos]'),'click',clear);
    on(files,'change',()=>{
      urls.forEach(u=>URL.revokeObjectURL(u));urls=[];grid.replaceChildren();
      const chosen=[...files.files];const accepted=chosen.filter(f=>['image/jpeg','image/png','image/webp'].includes(f.type)&&f.size<=50*1024*1024).slice(0,10);
      accepted.forEach(file=>{const url=URL.createObjectURL(file);urls.push(url);const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=url;img.alt='Unsaved final installation photo preview';caption.textContent=file.name;const label=document.createElement('label');label.textContent='Photo stage';const stage=document.createElement('select');stage.setAttribute('aria-label','Photo stage for '+file.name);['Final','Before','After'].forEach(text=>{const option=document.createElement('option');option.textContent=text;stage.append(option);});label.append(stage);figure.append(img,caption,label);grid.append(figure);});
      status.textContent=`${accepted.length} local photo preview(s). Nothing uploaded.`+(accepted.length!==chosen.length?' Preview limit: 10 JPEG, PNG or WebP images, up to 50 MB each.':'');
    });
    root.closest('.crm-panel').classList.remove('is-field-view');
  }
  return Object.freeze({render,mount,dispose,measurement});
})();
