// ── Theme toggle ─────────────────────────────────────────────
// Persists preference in localStorage across all pages.
(function () {
  const STORAGE_KEY = 'ls-theme';
  const btn = document.getElementById('themeBtn');

  // Apply saved preference (or system preference) immediately
  const saved = localStorage.getItem(STORAGE_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved ? saved === 'dark' : prefersDark;

  applyTheme(isDark);

  // Wire up the button
  if (btn) {
    btn.addEventListener('click', function () {
      const currentlyDark = document.documentElement.getAttribute('data-theme') === 'dark';
      applyTheme(!currentlyDark);
      localStorage.setItem(STORAGE_KEY, !currentlyDark ? 'dark' : 'light');
    });
  }

  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (btn) btn.textContent = dark ? '☀️' : '🌙';
  }
})();
