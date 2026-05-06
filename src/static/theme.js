(function () {
  const root = document.documentElement;

  // Initial theme: stored > system preference
  function getInitial() {
    try {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    const btn = document.querySelector('.theme-btn');
    if (btn) btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    const sun = document.querySelector('.theme-btn .icon-sun');
    const moon = document.querySelector('.theme-btn .icon-moon');
    if (sun && moon) {
      sun.style.display  = t === 'dark' ? 'block' : 'none';
      moon.style.display = t === 'dark' ? 'none'  : 'block';
    }
  }

  applyTheme(getInitial());

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('.theme-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        try { localStorage.setItem('theme', next); } catch (e) {}
      });
    }

    const menuBtn = document.querySelector('.menu-btn');
    const mobileNav = document.querySelector('.mobile-nav');
    if (menuBtn && mobileNav) {
      menuBtn.addEventListener('click', () => {
        mobileNav.classList.toggle('open');
        const open = mobileNav.classList.contains('open');
        menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        menuBtn.textContent = open ? 'Close' : 'Menu';
      });
    }
  });
})();