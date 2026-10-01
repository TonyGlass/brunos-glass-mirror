(() => {
  const SUPABASE_URL = globalThis.BRUNO_PUBLIC_CONFIG.supabaseUrl;
  const SUPABASE_PUBLISHABLE_KEY = globalThis.BRUNO_PUBLIC_CONFIG.supabasePublishableKey;
  const endpoint = `${SUPABASE_URL}/functions/v1/submit-quote`;
  const form = document.querySelector('#tracking-form');
  const status = document.querySelector('#tracking-status');
  const result = document.querySelector('#tracking-result');
  if (!form || !status || !result) return;
  const money = value => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(Number(value) || 0);
  const row = (label, value) => {
    const element = document.createElement('p');
    const name = document.createElement('strong');
    name.textContent = `${label}: `;
    element.append(name, document.createTextNode(value == null || value === '' ? 'Not recorded' : String(value)));
    return element;
  };
  async function request(action, credentials) {
    const response = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${SUPABASE_PUBLISHABLE_KEY}`},body:JSON.stringify({action,...credentials})});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not load project tracking.');
    return body.project;
  }
  function render(project, credentials) {
    result.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = `Project Order ${project.orderNumber}`;
    const stages = document.createElement('ol'); stages.className = 'tracking-stages';
    stages.setAttribute('aria-label','Recorded project progress');
    for (const stage of window.BrunoTrackingStatus.stages(project)) {
      const item = document.createElement('li'); const label = document.createElement('strong'); const detail = document.createElement('span');
      label.textContent = stage.label; detail.textContent = stage.detail; item.append(label,detail); stages.append(item);
    }
    result.append(stages);
    result.append(title, row('Project type', project.projectType), row('Project status', project.status), row('Request received', project.createdAt ? new Date(project.createdAt).toLocaleDateString() : null), row('Measurement status', project.measurementCompletedAt ? `Verified ${new Date(project.measurementCompletedAt).toLocaleDateString()}` : 'Not yet verified'), row('Verified dimensions', project.verifiedMeasurements ? `${project.verifiedMeasurements.width} × ${project.verifiedMeasurements.height} in` : 'Pending'), row('Installation status', project.installationStatus), row('Installation date', project.installationScheduledAt ? new Date(project.installationScheduledAt).toLocaleDateString() : null));
    if (project.preliminaryEstimate != null) result.append(row('Preliminary estimate', money(project.preliminaryEstimate)));
    if (project.preliminaryEstimateRange) result.append(row('Preliminary estimate range', `${money(project.preliminaryEstimateRange.low)} – ${money(project.preliminaryEstimateRange.high)}`));
    const final = document.createElement('section');
    const heading = document.createElement('h4'); heading.textContent = 'Final Quote'; final.append(heading);
    if (project.finalQuote.status === 'Published' || project.finalQuote.status === 'Accepted') {
      final.append(row('Status', project.finalQuote.status), row('Final price', money(project.finalQuote.price)), row('Quote date', project.finalQuote.quoteDate), row('Expires', project.finalQuote.expiresAt), row('Scope', project.finalQuote.scope));
      final.append(row('Payments received', project.payment.received == null ? null : money(project.payment.received)), row('50% to commence', money(project.payment.requiredToCommence)), row('Remaining balance', project.payment.remainingBalance == null ? null : money(project.payment.remainingBalance)));
      if (project.finalQuote.status === 'Published') {
        const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'button button-accent'; accept.textContent = 'ACCEPT FINAL QUOTE';
        accept.addEventListener('click', async () => { accept.disabled = true; status.textContent = 'Recording your approval…'; try { const updated = await request('accept-final-quote', credentials); render(updated, credentials); status.textContent = 'Final Quote accepted. No payment was charged.'; } catch (error) { status.textContent = error.message; accept.disabled = false; } });
        final.append(accept, document.createTextNode(' Acceptance records your approval only. It does not charge a payment.'));
      }
    } else final.append(row('Status', 'Bruno has not published the Final Quote yet.'));
    result.append(final); result.hidden = false;
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const credentials = {orderNumber:form.elements.orderNumber.value.trim(),accessCode:form.elements.accessCode.value.trim()};
    if (!form.reportValidity()) return;
    status.textContent = 'Verifying your private project access…'; result.hidden = true;
    try { render(await request('track', credentials), credentials); status.textContent = 'Project details loaded securely.'; }
    catch (error) { status.textContent = error.message; }
  });
})();
