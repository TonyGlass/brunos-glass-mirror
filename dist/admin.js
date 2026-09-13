const SUPABASE_URL = 'https://ygcpfehitvhipsncqxdm.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_uHHniNJW39sY0x3afdkx1g_53ZJrTHl';
const ADMIN_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/admin-quotes`;
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const statuses = ['New', 'Reviewing', 'Quoted', 'Approved', 'Completed', 'Lost'];

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

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(Number(value));
}

function estimateLabel(quote) {
  if (quote.estimated_price_low !== null && quote.estimated_price_high !== null) {
    return `${formatMoney(quote.estimated_price_low)}–${formatMoney(quote.estimated_price_high)}`;
  }
  return formatMoney(quote.estimated_price);
}

async function callAdmin(action, payload = {}) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  const response = await fetch(ADMIN_FUNCTION_URL, {
    method: 'POST',
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
        <div class="client-meta">${escapeHtml(quote.email || quote.phone || 'No contact')}</div>
      </td>
      <td>${escapeHtml(quote.service || '—')}</td>
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
  return `<div class="detail-field${full ? ' full' : ''}"><label>${label}</label><p class="detail-value${mono ? ' mono' : ''}">${escapeHtml(value ?? '—')}</p></div>`;
}

function renderDetail(quote) {
  const photoMarkup = (quote.photos || []).map((photo) => `
    <a href="${escapeHtml(photo.signedUrl)}" target="_blank" rel="noopener">
      <img src="${escapeHtml(photo.signedUrl)}" alt="Project photo" loading="lazy" />
    </a>
  `).join('');
  const mailto = `mailto:${encodeURIComponent(quote.email || '')}`;
  const sms = `sms:${String(quote.phone || '').replace(/[^+\d]/g, '')}`;

  detail.innerHTML = `
    <div class="detail-header">
      <div>
        <h3>${escapeHtml(quote.name || 'Unnamed customer')}</h3>
        <p class="detail-email">${escapeHtml(quote.email || 'No email')}</p>
      </div>
      <span class="status-badge">${escapeHtml(quote.status || 'New')}</span>
    </div>
    <div class="detail-actions">
      <a class="button contact-button" href="${sms}">Text Customer</a>
      <a class="button contact-button" href="${mailto}">Email Customer</a>
    </div>
    <div class="detail-fields">
      ${detailField('Phone', quote.phone)}
      ${detailField('City', quote.city)}
      ${detailField('Service', quote.service)}
      ${detailField('Product', quote.product)}
      ${detailField('Door / enclosure', quote.door_type)}
      ${detailField('Glass type', quote.glass_type)}
      ${detailField('Hardware finish', quote.hardware_finish)}
      ${detailField('Handle style', quote.handle_style)}
      ${detailField('Quantity', quote.quantity)}
      ${detailField('Width', quote.width)}
      ${detailField('Height', quote.height)}
      ${detailField('Square feet', quote.square_feet)}
      ${detailField('Estimated low', formatMoney(quote.estimated_price_low))}
      ${detailField('Estimated high', formatMoney(quote.estimated_price_high))}
      ${detailField('Estimated price', formatMoney(quote.estimated_price))}
      ${detailField('Created', formatDate(quote.created_at), false, true)}
      ${detailField('Message', quote.message, true)}
    </div>
    <div class="detail-field">
      <label>Project photos</label>
      ${photoMarkup ? `<div class="photo-grid">${photoMarkup}</div>` : '<p class="detail-value">No photos attached.</p>'}
    </div>
    <form class="edit-grid" id="quote-edit-form">
      <div class="detail-field">
        <label for="quote-status">Status</label>
        <select id="quote-status" name="status">${statuses.map((status) => `<option value="${status}" ${status === quote.status ? 'selected' : ''}>${status}</option>`).join('')}</select>
      </div>
      <div class="detail-field">
        <label for="final-price">Final price</label>
        <input id="final-price" name="final_price" type="number" min="0" step="0.01" value="${quote.final_price ?? ''}" placeholder="0.00" />
      </div>
      <button class="button button-accent" type="submit">Save changes <span aria-hidden="true">↗</span></button>
    </form>
  `;

  document.querySelector('#quote-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = document.querySelector('#quote-status').value;
    const finalPriceValue = document.querySelector('#final-price').value;
    const finalPrice = finalPriceValue === '' ? null : Number(finalPriceValue);
    try {
      setStatus(crmStatus, 'Saving changes...');
      const result = await callAdmin('update', { id: quote.id, status, final_price: finalPrice });
      quotes.set(String(result.quote.id), result.quote);
      renderQuoteRows([...quotes.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      renderDetail({ ...quote, ...result.quote, photos: quote.photos });
      setStatus(crmStatus, 'Quote updated.');
    } catch (error) {
      setStatus(crmStatus, error.message, true);
    }
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

async function loadQuotes() {
  try {
    setStatus(crmStatus, 'Loading quotes...');
    const result = await callAdmin('list');
    renderQuoteRows(result.quotes);
    setStatus(crmStatus, result.quotes.length ? '' : 'No quotes found.');
  } catch (error) {
    setStatus(crmStatus, error.message, true);
  }
}

async function showCrm(session) {
  loginPanel.hidden = Boolean(session);
  crmPanel.hidden = !session;
  if (session) await loadQuotes();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(loginStatus, 'Signing in...');
  const email = document.querySelector('#login-email').value.trim();
  const password = document.querySelector('#login-password').value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    setStatus(loginStatus, error.message, true);
    return;
  }
  loginForm.reset();
  setStatus(loginStatus, '');
});

document.querySelector('#sign-out').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
});
document.querySelector('#refresh-quotes').addEventListener('click', loadQuotes);
supabaseClient.auth.onAuthStateChange((_event, session) => showCrm(session));
supabaseClient.auth.getSession().then(({ data: { session } }) => showCrm(session));
