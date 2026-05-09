/* ------------------------------------------------------------------
   scroll-reveal.js
   - Adds `.in-view` to any element with [data-animate] while visible.
   - Exposes window.SceneScroll.register(el, onProgress) for scenes
     that need *scrubbed* animation (progress 0→1 through viewport).
     onProgress is only called while the element is in view, so you
     never animate off-screen scenes.
   ------------------------------------------------------------------ */
(() => {
  const reveal = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) e.target.classList.add('in-view');
      else                  e.target.classList.remove('in-view');
    });
  }, { threshold: 0.2, rootMargin: '0px 0px -10% 0px' });

  document.querySelectorAll('[data-animate]').forEach(el => reveal.observe(el));

  /* --- Scrubbed scenes ---------------------------------------------- */
  const scenes = new Map();   // el -> { cb, active }

  const activity = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      const s = scenes.get(e.target);
      if (s) s.active = e.isIntersecting;
    });
  }, { threshold: 0, rootMargin: '20% 0px 20% 0px' }); // start tracking a bit early

  function localProgress(el) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const total = r.height + vh;
    const traveled = vh - r.top;
    return Math.min(1, Math.max(0, traveled / total));
  }

  function tick() {
    scenes.forEach((s, el) => {
      if (!s.active) return;            // <- the important bit
      s.cb(localProgress(el), el);
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.SceneScroll = {
    register(el, cb) {
      if (!el || typeof cb !== 'function') return;
      scenes.set(el, { cb, active: false });
      activity.observe(el);
    },
    unregister(el) {
      scenes.delete(el);
      activity.unobserve(el);
    }
  };
})();