// Reuse the existing form and website; a hash identifies the focused task view.
(() => {
  const bar = document.createElement('nav');
  bar.className = 'quote-app-bar'; bar.setAttribute('aria-label','Quotation application');
  bar.innerHTML = `<a href="#top" data-exit-quote>← Back to website</a><strong data-app-title>Request a quote</strong><a href="#tracking">Track project</a>`;
  document.querySelector('.quote-header').after(bar);
  function setView(view) {
    const active = view === 'quote' || view === 'tracking';
    document.body.classList.toggle('quote-app-active', active);
    document.body.dataset.taskView = active ? view : '';
    bar.querySelector('[data-app-title]').textContent = view === 'tracking' ? 'Track your project' : 'Request a quote';
    if (active) {
      document.querySelector('#site-nav').classList.remove('is-open');
      document.querySelector('.menu-toggle').setAttribute('aria-expanded','false');
      document.querySelector('.floating-contact').setAttribute('aria-expanded','false');
      document.querySelector('#contact').hidden = true;
    }
  }
  function route() { setView(location.hash === '#quote' ? 'quote' : location.hash === '#tracking' ? 'tracking' : ''); }
  document.addEventListener('click', event => {
    const target = event.target.closest('a, button'); if (!target) return;
    const href = target.getAttribute('href');
    if (target.matches('[data-start-project], [data-custom-service]') || href === '#quote' || target.matches('[data-select="service"]')) {
      setView('quote');
      if (location.hash !== '#quote') history.pushState(null,'','#quote');
    } else if (href === '#tracking') {
      setView('tracking');
    } else if (target.matches('[data-exit-quote], .quote-header .brand')) {
      setView('');
    } else if (href?.startsWith('#') && !target.closest('#quote')) {
      setView('');
    }
  }, true);
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  route();
})();
