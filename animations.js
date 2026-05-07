// animations.js — all scroll & canvas animations for the home page.
// Requires GSAP + ScrollTrigger (loaded globally in base.html.j2).
import { renderPSF } from './psf.js';

gsap.registerPlugin(ScrollTrigger);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── 1. HERO STARFIELD ─────────────────────────────────────────── */
(function hero() {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let stars = [];
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  function resize() {
    canvas.width  = canvas.offsetWidth  * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    stars = Array.from({ length: 250 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: (Math.random() * 1.4 + 0.3) * dpr,
      a: Math.random(),
      da: (Math.random() - 0.5) * 0.008,
    }));
  }

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of stars) {
      s.a += s.da;
      if (s.a < 0.1 || s.a > 1) s.da *= -1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${s.a})`;
      ctx.fill();
    }
    if (!reduceMotion) requestAnimationFrame(tick);
  }

  window.addEventListener('resize', resize);
  resize();
  tick();

  gsap.from('.hero-name, .hero-title, .hero-affiliation, .hero-btn', {
    y: 20, opacity: 0, duration: 1, stagger: 0.15, ease: 'power2.out'
  });
})();

/* ── 2. PSF (math-generated, scroll-scrubbed) ──────────────────── */
(function psf() {
  const canvas = document.getElementById('psfCanvas');
  if (!canvas) return;
  const label = document.querySelector('#psf-section .psf-label');
  let progress = 0;

  function draw() {
    const aberration = (1 - progress) * 1.4;
    const noise      = (1 - progress) * 0.14;
    renderPSF(canvas, { aberration, noise });
    if (label) label.textContent = progress > 0.7 ? 'Corrected PSF ✓' : 'Aberrated PSF';
  }

  ScrollTrigger.create({
    trigger: '#psf-section',
    start: 'top 80%',
    end: 'bottom 40%',
    scrub: true,
    onUpdate: self => { progress = self.progress; draw(); },
  });
  draw();
})();

/* ── 3. NETWORK (reveal + activation) ──────────────────────────── */
(function network() {
  const canvas = document.getElementById('networkCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const layers = [3, 5, 5, 4];
  const labels = ['PSF', 'CNN', 'hidden', 'Zernike'];
  let t = 0;

  const pos = (l, i) => ({
    x: 60 + l * (W - 120) / (layers.length - 1),
    y: H / 2 - 10 + (i - (layers[l] - 1) / 2) * 38,
  });

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // edges
    for (let l = 0; l < layers.length - 1; l++) {
      const p = Math.max(0, Math.min(1, t * layers.length - l));
      for (let i = 0; i < layers[l]; i++) {
        for (let j = 0; j < layers[l+1]; j++) {
          const a = pos(l, i), b = pos(l+1, j);
          ctx.strokeStyle = `rgba(100,180,255,${p * 0.35})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }

    // nodes
    for (let l = 0; l < layers.length; l++) {
      const p = Math.max(0, Math.min(1, t * layers.length - l + 1));
      for (let i = 0; i < layers[l]; i++) {
        const { x, y } = pos(l, i);
        const pulse = reduceMotion ? 0 : Math.sin(performance.now()/600 + l*1.3 + i) * 1.5;
        ctx.beginPath(); ctx.arc(x, y, 8 + pulse, 0, Math.PI*2);
        ctx.fillStyle   = `rgba(30,100,200,${p})`;   ctx.fill();
        ctx.strokeStyle = `rgba(140,200,255,${p})`;  ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.fillStyle = `rgba(180,220,255,${0.7 * Math.max(0, Math.min(1, t * layers.length - l + 1))})`;
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(labels[l], pos(l, Math.floor(layers[l]/2)).x, H - 10);
    }
  }

  ScrollTrigger.create({
    trigger: '#network-section',
    start: 'top 80%',
    end: 'bottom 40%',
    scrub: true,
    onUpdate: self => { t = self.progress; draw(); },
  });
  if (!reduceMotion) gsap.ticker.add(draw);
  draw();
})();

/* ── 4. ZERNIKE BAR CHART ──────────────────────────────────────── */
(function zernike() {
  const canvas = document.getElementById('zernikeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const modes  = ['Z4\nDefoc', 'Z5\nAstig', 'Z6\nAstig', 'Z7\nComa', 'Z8\nComa', 'Z11\nSph'];
  const values = [0.12, 0.08, 0.05, 0.03, 0.02, 0.015];
  const vmax   = Math.max(...values);
  let t = 0;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const pad = 36, baseY = H - 40, maxH = H - 70;
    const slot = (W - 2*pad) / modes.length;
    const barW = slot - 10;

    ctx.strokeStyle = 'rgba(180,220,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(pad, 10); ctx.lineTo(pad, baseY); ctx.lineTo(W - 12, baseY);
    ctx.stroke();

    modes.forEach((label, i) => {
      const rel = values[i] / vmax;
      const grow = Math.max(0, Math.min(1, t * modes.length - i + 1));
      const h = rel * maxH * 0.75 * grow;
      const x = pad + 6 + i * slot;

      const grad = ctx.createLinearGradient(0, baseY - h, 0, baseY);
      grad.addColorStop(0, 'rgba(150,205,255,0.95)');
      grad.addColorStop(1, 'rgba(30,100,200,0.55)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, baseY - h, barW, h);

      ctx.fillStyle = 'rgba(200,225,255,0.75)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      label.split('\n').forEach((ln, k) =>
        ctx.fillText(ln, x + barW/2, H - 22 + k * 11));
    });

    ctx.fillStyle = 'rgba(180,220,255,0.55)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('nm RMS', 4, 18);
  }

  ScrollTrigger.create({
    trigger: '#zernike-section',
    start: 'top 80%',
    end: 'bottom 40%',
    scrub: true,
    onUpdate: self => { t = self.progress; draw(); },
  });
  draw();
})();

/* ── 5. EUCLID (lazy-loaded Three.js) ──────────────────────────── */
ScrollTrigger.create({
  trigger: '#euclid-section',
  start: 'top 150%',
  once: true,
  onEnter: () => { import('./euclid.js').catch(err => console.error('Euclid load failed', err)); },
});