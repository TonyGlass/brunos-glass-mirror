// Keep the public root focused on the quotation wizard. The tracking view is
// available from the compact application navigation and the submission screen.
(() => {
  const bar = document.createElement('nav');
  bar.className = 'quote-app-bar';
  bar.setAttribute('aria-label', 'Quotation application');
  bar.innerHTML = '<strong data-app-title>Project quotation</strong><a data-task-link href="#tracking">Track Your Project</a>';
  document.querySelector('.quote-header')?.after(bar);

  function setView(view) {
    const normalized = view === 'tracking' ? 'tracking' : 'quote';
    document.body.classList.add('quote-app-active');
    document.body.dataset.taskView = normalized;
    bar.querySelector('[data-app-title]').textContent = normalized === 'tracking' ? 'Track Your Project' : 'Project quotation';
    const taskLink = bar.querySelector('[data-task-link]');
    taskLink.href = normalized === 'tracking' ? '#quote' : '#tracking';
    taskLink.textContent = normalized === 'tracking' ? 'Return to quotation' : 'Track Your Project';
    const nav = document.querySelector('#site-nav');
    if (nav) nav.classList.remove('is-open');
    const menu = document.querySelector('.menu-toggle');
    menu?.setAttribute('aria-expanded', 'false');
    const contact = document.querySelector('#contact');
    if (contact) contact.hidden = true;
    document.querySelector('.floating-contact')?.setAttribute('aria-expanded', 'false');
  }

  function route() {
    setView(location.hash === '#tracking' ? 'tracking' : 'quote');
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('a, button');
    if (!target) return;
    const href = target.getAttribute('href');
    if (href === '#tracking' || href === '#quote') {
      // setView updates this navigation link's href. Prevent the browser's
      // default action from reading that new href instead of the clicked one.
      event.preventDefault();
      setView(href === '#tracking' ? 'tracking' : 'quote');
      if (location.hash !== href) location.hash = href;
    } else if (target.matches('[data-start-project], [data-custom-service], [data-quick-service], [data-quick-start], [data-exit-quote], .quote-header .brand')) setView('quote');
  }, true);
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  route();
})();
