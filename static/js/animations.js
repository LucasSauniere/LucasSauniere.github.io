// animations.js — master animation script for the home page.
// Requires GSAP + ScrollTrigger loaded globally (see base.html.j2).
//
// Acts 1/6 live here. Scene-heavy acts (Euclid, PSF, CNN) are lazy-loaded
// from dedicated modules under ./ so this file stays boot-fast.

const { gsap } = window;
gsap.registerPlugin(window.ScrollTrigger);
const ST = window.ScrollTrigger;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DPR = Math.min(2, window.devicePixelRatio || 1);

/* ────────────────────────────────────────────────────────────────
   ACT 1 — Launch: starfield + hero text, with parallax on scroll.
   ──────────────────────────────────────────────────────────────── */
(function act1() {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  /* Three layers for parallax depth. Closer stars are bigger and move
     faster when the viewport scrolls. */
  const LAYERS = [
    { count: 120, sizeMin: 0.3, sizeMax: 0.9, depth: 0.25, twinkle: 0.003 },
    { count:  90, sizeMin: 0.5, sizeMax: 1.3, depth: 0.55, twinkle: 0.006 },
    { count:  60, sizeMin: 0.9, sizeMax: 2.0, depth: 1.00, twinkle: 0.010 },
  ];
  let stars = [];
  let W = 0, H = 0;
  let scrollY = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    canvas.width  = W * DPR;
    canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    stars = [];
    for (const L of LAYERS) {
      for (let i = 0; i < L.count; i++) {
        stars.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: L.sizeMin + Math.random() * (L.sizeMax - L.sizeMin),
          a: 0.3 + Math.random() * 0.7,
          da: (Math.random() - 0.5) * L.twinkle,
          depth: L.depth,
        });
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // Parallax shift: the further down we've scrolled the hero,
    // the more deep stars are pushed up. Feels like a slow camera dolly.
    const shift = scrollY * 0.12;
    for (const s of stars) {
      s.a += s.da;
      if (s.a < 0.15 || s.a > 1) s.da *= -1;
      const y = s.y - shift * s.depth;
      if (y < -5 || y > H + 5) continue;
      ctx.beginPath();
      ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,235,255,${s.a})`;
      ctx.fill();
    }
  }

  let rafId = 0;
  function tick() {
    draw();
    if (!reduceMotion) rafId = requestAnimationFrame(tick);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('scroll', () => {
    scrollY = window.scrollY || 0;
  }, { passive: true });

  requestAnimationFrame(() => {
    resize();
    tick();

    if (!reduceMotion) {
      gsap.from('.hero-kicker',       { y: 14, opacity: 0, duration: 0.9, ease: 'power2.out', delay: 0.1 });
      gsap.from('.hero-name',         { y: 22, opacity: 0, duration: 1.1, ease: 'power3.out', delay: 0.25 });
      gsap.from('.hero-title',        { y: 14, opacity: 0, duration: 0.9, ease: 'power2.out', delay: 0.45 });
      gsap.from('.hero-affiliation',  { y: 10, opacity: 0, duration: 0.9, ease: 'power2.out', delay: 0.55 });
      gsap.from('.hero-actions .hero-btn', {
        y: 12, opacity: 0, duration: 0.8, ease: 'power2.out',
        stagger: 0.08, delay: 0.7,
      });
      gsap.from('.hero-socials li', {
        y: 8, opacity: 0, duration: 0.7, ease: 'power2.out',
        stagger: 0.05, delay: 0.9,
      });
    }

    // Fade the hero text out, and the whole vignette darken, as we leave Act 1.
    ST.create({
      trigger: '#launch',
      start: 'top top',
      end: 'bottom top',
      scrub: true,
      onUpdate: self => {
        const p = self.progress;
        gsap.set('.hero-text',     { opacity: 1 - p * 1.1, y: -p * 40 });
        gsap.set('.scroll-hint',   { opacity: Math.max(0, 1 - p * 3) });
        gsap.set('.hero-vignette', { opacity: 1 + p * 0.3 });
      },
    });
  });
})();

/* ────────────────────────────────────────────────────────────────
   ACTS 2–6 — placeholder entrance animations.
   Each one gets a subtle fade-in-and-up as it enters the viewport,
   so the page has a consistent feel until the real scenes land.
   ──────────────────────────────────────────────────────────────── */
(function entranceAnimations() {
  if (reduceMotion) return;
  const sections = document.querySelectorAll(
    '#mission, #photon, #problem, #imaging, #measurement, #denoise, #network, #validation, #focus-ramp'
  );
  sections.forEach(sec => {
    const kicker = sec.querySelector('.act-kicker');
    const h2     = sec.querySelector('h2');
    const p      = sec.querySelector('p:not(.act-kicker)');
    const visual = sec.querySelector('.scroll-section-visual, .sandbox-grid');
    const links  = sec.querySelectorAll('.outro-links .hero-btn');

    const targets = [kicker, h2, p, visual, ...links].filter(Boolean);
    if (!targets.length) return;

    gsap.from(targets, {
      y: 28, opacity: 0, duration: 0.9, ease: 'power2.out', stagger: 0.1,
      scrollTrigger: {
        trigger: sec,
        start: 'top 72%',
        toggleActions: 'play none none reverse',
      },
    });
  });
})();

/* ────────────────────────────────────────────────────────────────
   PROGRESS RAIL — highlights the current section while it's on screen.
   ──────────────────────────────────────────────────────────────── */
(function progressRail() {
  const rail = document.querySelector('.progress-rail');
  if (!rail) return;
  const items = new Map();
  rail.querySelectorAll('li').forEach(li => {
    items.set(li.dataset.rail, li);
  });

  function setActive(key) {
    rail.querySelectorAll('li').forEach(li =>
      li.classList.toggle('active', li.dataset.rail === key)
    );
  }

  document.querySelectorAll('[data-rail-target]').forEach(sec => {
    const key = sec.dataset.railTarget;
    ST.create({
      trigger: sec,
      start: 'top 45%',
      end:   'bottom 45%',
      onToggle: self => { if (self.isActive) setActive(key); },
      onRefresh: self => { if (self.isActive) setActive(key); },
    });
  });

  // Smooth scroll on rail click (respects reduced-motion).
  rail.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (!a) return;
    const id = a.getAttribute('href');
    if (!id || !id.startsWith('#')) return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  });
})();

/* ────────────────────────────────────────────────────────────────
   Lazy-load scene modules for later acts.
   These are stubs for now — the real modules land in chunks 2–5.
   Wrapped in try/catch so a missing file never breaks the page.
   ──────────────────────────────────────────────────────────────── */
(function lazySceneLoaders() {
  const lazy = [
    { sel: '#mission',     mod: './euclid.js'      },
    { sel: '#photon',      mod: './psf.js'         },
    { sel: '#problem',     mod: './psf.js'         },
    { sel: '#imaging',     mod: './imaging.js'     },
    { sel: '#measurement', mod: './measurement.js' },
    { sel: '#denoise',     mod: './denoise.js'     },
    { sel: '#network',     mod: './network.js'     },
    { sel: '#validation',  mod: './validation.js'  },
    { sel: '#focus-ramp',  mod: './focusramp.js'   },
  ];
  for (const { sel, mod } of lazy) {
    const el = document.querySelector(sel);
    if (!el) continue;
    ST.create({
      trigger: el,
      start: 'top bottom',
      once: true,
      onEnter: () => {
        import(mod)
          .then(() => ST.refresh())
          .catch((err) => console.error(`[animations] failed to load ${mod}:`, err));
      },
    });
  }
})();

/* ────────────────────────────────────────────────────────────────
   Snap to section starts on scroll release. Keeps each Act fully
   visible — the user lands at an Act's top instead of stranding on
   a gap between two Acts. Skipped under prefers-reduced-motion.
   ──────────────────────────────────────────────────────────────── */
(function sectionSnap() {
  if (reduceMotion) return;
  const ids = ['launch', 'mission', 'photon', 'problem', 'imaging',
               'measurement', 'denoise', 'network', 'validation', 'focus-ramp'];

  function positions() {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const out = [];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      out.push(Math.min(1, Math.max(0, el.offsetTop / max)));
    }
    return out;
  }

  ST.create({
    start: 0,
    end: 'max',
    snap: {
      // Recomputed each call so resize / lazy layout shifts don't desync.
      snapTo: (value) => {
        const ps = positions();
        if (!ps.length) return value;
        let best = ps[0], bestD = Math.abs(value - best);
        for (const p of ps) {
          const d = Math.abs(value - p);
          if (d < bestD) { bestD = d; best = p; }
        }
        return best;
      },
      duration: { min: 0.25, max: 0.6 },
      delay: 0.12,
      ease: 'power2.inOut',
      directional: false,
    },
  });
})();

/* Final refresh once everything has had a chance to size. */
window.addEventListener('load', () => ST.refresh());