// Theme toggle + mobile menu
(function () {
  const root    = document.documentElement;
  const btn     = document.getElementById('themeBtn');
  const menuBtn = document.getElementById('menuBtn');
  const mobile  = document.getElementById('mobileNav');

  // Initial theme: saved → else system preference
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch (e) {}
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initial = saved || (systemDark ? 'dark' : 'light');
  root.setAttribute('data-theme', initial);

  if (btn) btn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
  });

  if (menuBtn && mobile) menuBtn.addEventListener('click', () => {
    mobile.classList.toggle('open');
  });
})();