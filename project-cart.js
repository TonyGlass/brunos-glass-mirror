/* In-memory planning only. No persistence, networking, or submission adapter. */
(() => {
  const panel = document.querySelector('[data-wizard-step="7"]');
  if (!panel) return;
  let items = [];
  let sequence = 0;
  const cart = document.createElement('section');
  cart.className = 'project-cart';
  cart.innerHTML = `<p class="eyebrow">Browse / Configure / Project</p><h2>Project Cart</h2>
    <p>Planning preview only. Items stay in this tab until refresh. REQUEST A QUOTE sends only the current form configuration, not this cart. Multi-item requests are not connected yet.</p>
    <button type="button" class="button button-dark" data-cart-add>Add to Project</button>
    <p role="status" data-cart-status></p><ol data-cart-items></ol>
    <button type="button" class="wizard-back" data-cart-browse>Browse / configure another item</button>`;
  panel.prepend(cart);
  const list = cart.querySelector('[data-cart-items]');
  const status = cart.querySelector('[data-cart-status]');
  const value = id => document.getElementById(id)?.value || '';
  function render() {
    list.replaceChildren();
    items.forEach(item => {
      const row = document.createElement('li');
      const title = document.createElement('h3');
      title.textContent = item.service + (item.product ? ' / ' + item.product : '');
      const detail = document.createElement('p');
      detail.textContent = [item.glass_type, item.enduroShield ? 'EnduroShield' : '', item.hardware_finish, item.handle_style,
        `${item.width} × ${item.height} in`, item.estimateLabel].filter(Boolean).join(' · ');
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'wizard-back'; remove.textContent = 'Remove item';
      remove.setAttribute('aria-label', 'Remove ' + title.textContent);
      remove.onclick = () => { items = items.filter(i => i.id !== item.id); render(); };
      row.append(title, detail, remove); list.append(row);
    });
    status.textContent = items.length ? `${items.length} unsaved planning item(s). Not included in submission.` : 'Your planning cart is empty.';
  }
  cart.querySelector('[data-cart-add]').onclick = () => {
    const service = value('service');
    if (!['Shower Doors', 'Mirror', 'Glass'].includes(service) || !value('width') || !value('height')) {
      status.textContent = 'Configure an available service and measurements first.'; return;
    }
    items.push({id: ++sequence, service, product: value('product'), glass_type: value('glass-type'),
      enduroShield: document.querySelector('#enduro-shield')?.checked === true, hardware_finish: value('hardware-finish'), handle_style: value('handle-style'),
      width: value('width'), height: value('height'),
      estimateLabel: document.getElementById('estimated-price-value')?.textContent || 'Estimate unavailable'});
    render();
  };
  cart.querySelector('[data-cart-browse]').onclick = () => document.querySelector('[data-jump-step="1"]')?.click();
  // Future adapter must explicitly validate item schemas and server pricing before submission.
  window.ProjectCartPreview = Object.freeze({getItems: () => items.map(item => ({...item}))});
  render();
})();
