// imaging.js — Act 5: galaxy field convolved with the aberrated PSF.
// Why the PSF matters in astronomical observations, especially for
// Euclid: a clean synthetic field goes in on the left, the same
// field after the as-built PSF has done its work comes out on the
// right. As scroll progress advances, aberration ramps up; the
// observed field smears, and galaxy shapes pick up a bias the way
// the PSF leans — exactly the systematic that has to be subtracted
// before any weak-lensing measurement is trustworthy.
// Pure Canvas 2D.

const ST = window.ScrollTrigger;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const container = document.getElementById('imaging-scene');
if (container) initImaging(container);

const FIELD_N = 160;   // synthetic-field resolution
const PSF_N   = 17;    // odd; centred kernel
const STATES  = 6;     // discrete aberration levels for cross-fade

function initImaging(container) {
  const fallback = container.querySelector('.scene-fallback');
  const canvas = document.createElement('canvas');
  canvas.className = 'scene-canvas';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  let W = 0, H = 0, vertical = false;
  function resize() {
    const r = container.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    vertical = W < 640;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  // ─── Precompute everything once — convolution is heavy ────────
  const truth = renderField(FIELD_N);
  const truthCanvas = makeFieldCanvas(truth, FIELD_N);

  const psfCanvases = [];
  const observedCanvases = [];
  const rmsLambda = [];   // approximate RMS WFE in waves, per state

  for (let s = 0; s < STATES; s++) {
    const t = s / (STATES - 1);
    // Aberration ramps from "near diffraction-limited" to "as-built".
    const psfOpts = {
      defocus: 0.05 + 0.55 * t,
      astigX:  0.10 + 0.55 * t,
      comaX:   0.00 + 0.35 * t,
    };
    const psf = renderPSF(PSF_N, psfOpts);
    psfCanvases.push(makeKernelCanvas(psf, PSF_N));

    const observed = convolveField(truth, FIELD_N, psf, PSF_N);
    observedCanvases.push(makeFieldCanvas(observed, FIELD_N));

    rmsLambda.push(0.04 + 0.42 * t);   // illustrative — not from a real WFE map
  }

  if (fallback) fallback.style.display = 'none';

  // ─── Scroll progress ──────────────────────────────────────────
  let progress = reduceMotion ? 1 : 0;
  const trigger = ST && ST.create({
    trigger: '#imaging',
    start: 'top bottom',
    end:   'bottom top',
    scrub: 1,
    onUpdate: (s) => { progress = s.progress; },
  });

  let raf = 0;
  function tick() {
    ctx.clearRect(0, 0, W, H);
    drawScene(ctx, W, H, progress, {
      truthCanvas, psfCanvases, observedCanvases, rmsLambda, vertical,
    });
    raf = requestAnimationFrame(tick);
  }
  tick();

  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    trigger && trigger.kill();
  }, { once: true });
}

/* ════════════════════════════════════════════════════════════════
   Scene composition.
     A. Truth field appears             p ∈ [0.00, 0.20]
     B. PSF appears + arrows draw       p ∈ [0.15, 0.40]
     C. Observed field cross-fades      p ∈ [0.30, 0.92]
                                        (ramps state index 0 → 5)
   ════════════════════════════════════════════════════════════════ */
function drawScene(ctx, W, H, p, S) {
  const A = phaseFade(p, 0.00, 0.20);
  const B = phaseFade(p, 0.15, 0.40);
  const C = phaseFade(p, 0.30, 0.92);

  // Continuous state index for cross-fade between adjacent precomputed states.
  const lerpT = phaseFade(p, 0.30, 0.92);
  const stateF = lerpT * (STATES - 1);
  const stateA = Math.floor(stateF);
  const stateB = Math.min(STATES - 1, stateA + 1);
  const blend = stateF - stateA;

  const padX = 18, padY = 18;
  const innerW = W - 2 * padX;
  const innerH = H - 2 * padY;

  if (S.vertical) {
    const ratios = [0.40, 0.18, 0.42];
    let y = padY;
    drawTruth   (ctx, padX, y, innerW, ratios[0] * innerH, S.truthCanvas, A);
    y += ratios[0] * innerH;
    drawPSF     (ctx, padX, y, innerW, ratios[1] * innerH, S, stateA, stateB, blend, B, true);
    y += ratios[1] * innerH;
    drawObserved(ctx, padX, y, innerW, ratios[2] * innerH, S, stateA, stateB, blend, C);
  } else {
    const ratios = [0.40, 0.18, 0.42];
    let x = padX;
    drawTruth   (ctx, x, padY, ratios[0] * innerW, innerH, S.truthCanvas, A);
    x += ratios[0] * innerW;
    drawPSF     (ctx, x, padY, ratios[1] * innerW, innerH, S, stateA, stateB, blend, B, false);
    x += ratios[1] * innerW;
    drawObserved(ctx, x, padY, ratios[2] * innerW, innerH, S, stateA, stateB, blend, C);
  }
}

function drawTruth(ctx, x, y, w, h, truthCanvas, fade) {
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  const { box, labelY } = panelBox(x, y, w, h);
  const side = Math.min(box.w, box.h);
  const px = box.x + (box.w - side) / 2;
  const py = box.y + (box.h - side) / 2;
  ctx.drawImage(truthCanvas, px, py, side, side);
  drawPanelFrame(ctx, px, py, side, side);
  drawCaption(ctx, x + w / 2, labelY, 'TRUE SCENE');
  ctx.restore();
}

function drawObserved(ctx, x, y, w, h, S, stateA, stateB, blend, fade) {
  ctx.save();
  const { box, labelY } = panelBox(x, y, w, h);
  const side = Math.min(box.w, box.h);
  const px = box.x + (box.w - side) / 2;
  const py = box.y + (box.h - side) / 2;

  if (fade <= 0) {
    // Before phase C kicks in, show the truth dimmed so the panel isn't empty.
    ctx.globalAlpha = 0.35;
    ctx.drawImage(S.truthCanvas, px, py, side, side);
  } else {
    // Cross-fade between adjacent state canvases as aberration ramps up.
    ctx.globalAlpha = 1 - blend;
    ctx.drawImage(S.observedCanvases[stateA], px, py, side, side);
    if (blend > 0) {
      ctx.globalAlpha = blend;
      ctx.drawImage(S.observedCanvases[stateB], px, py, side, side);
    }
    ctx.globalAlpha = 1;
  }

  drawPanelFrame(ctx, px, py, side, side);
  drawCaption(ctx, x + w / 2, labelY, 'AS OBSERVED');
  ctx.restore();
}

function drawPSF(ctx, x, y, w, h, S, stateA, stateB, blend, fade, vertical) {
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;

  const { box, labelY } = panelBox(x, y, w, h);
  // PSF kernel sits in the middle column. Make it square and centred.
  const side = Math.min(box.w * (vertical ? 0.30 : 0.85),
                        box.h * (vertical ? 0.85 : 0.45));
  const px = box.x + (box.w - side) / 2;
  const py = box.y + (box.h - side) / 2;

  ctx.globalAlpha = fade * (1 - blend);
  ctx.drawImage(S.psfCanvases[stateA], px, py, side, side);
  if (blend > 0) {
    ctx.globalAlpha = fade * blend;
    ctx.drawImage(S.psfCanvases[stateB], px, py, side, side);
  }
  ctx.globalAlpha = fade;

  // Arrows on either side of the PSF, indicating flow.
  ctx.strokeStyle = 'rgba(158, 197, 219, 0.45)';
  ctx.lineWidth = 1;
  if (vertical) {
    const xMid = box.x + box.w / 2;
    arrow(ctx, xMid, box.y, xMid, py - 4, true);
    arrow(ctx, xMid, py + side + 4, xMid, box.y + box.h, true);
  } else {
    const yMid = box.y + box.h / 2;
    arrow(ctx, box.x, yMid, px - 4, yMid, false);
    arrow(ctx, px + side + 4, yMid, box.x + box.w, yMid, false);
  }

  drawPanelFrame(ctx, px, py, side, side);
  drawCaption(ctx, x + w / 2, labelY, 'PSF (CONVOLVE)');

  // RMS-WFE readout below the kernel.
  const rms = (S.rmsLambda[stateA] * (1 - blend) + S.rmsLambda[stateB] * blend);
  ctx.fillStyle = 'rgba(246, 192, 106, 0.85)';
  ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelTextY = py + side + 6;
  if (labelTextY < labelY - 14) {
    ctx.fillText(`RMS  ${rms.toFixed(2)} λ`, px + side / 2, labelTextY);
  }

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════
   Visual primitives
   ════════════════════════════════════════════════════════════════ */
function panelBox(x, y, w, h) {
  const labelY = y + h - 4;
  return { box: { x: x + 4, y: y + 6, w: w - 8, h: h - 22 }, labelY };
}

function drawPanelFrame(ctx, x, y, w, h) {
  ctx.strokeStyle = 'rgba(158, 197, 219, 0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawCaption(ctx, cx, y, text) {
  ctx.fillStyle = 'rgba(230, 236, 255, 0.55)';
  ctx.font = '10.5px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, cx, y);
}

function arrow(ctx, x1, y1, x2, y2, vertical) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  if (vertical) {
    ctx.moveTo(x2 - 3, y2 - 3);
    ctx.lineTo(x2,     y2);
    ctx.lineTo(x2 + 3, y2 - 3);
  } else {
    ctx.moveTo(x2 - 3, y2 - 3);
    ctx.lineTo(x2,     y2);
    ctx.lineTo(x2 - 3, y2 + 3);
  }
  ctx.stroke();
}

/* ════════════════════════════════════════════════════════════════
   Synthetic field — galaxies on a low noise floor.
   Sersic-ish I(r) = I₀·exp(-r/r_e), with elliptical r in the
   galaxy's frame so we get a believable mix of round / edge-on /
   tilted shapes.
   ════════════════════════════════════════════════════════════════ */
function renderField(N) {
  const buf = new Float32Array(N * N);
  const rng = mulberry32(0xC0FFEE);

  // Background: low noise so the convolution has texture to act on.
  for (let i = 0; i < buf.length; i++) buf[i] = 0.03 + rng() * 0.03;

  // Eight galaxies of varied flux / size / orientation.
  const galaxies = [
    { x: 0.20, y: 0.28, r: 0.055, q: 0.55, pa: 0.6,  flux: 0.95 },
    { x: 0.46, y: 0.18, r: 0.038, q: 0.95, pa: 0.0,  flux: 0.70 },
    { x: 0.74, y: 0.30, r: 0.068, q: 0.70, pa: 1.5,  flux: 0.90 },
    { x: 0.32, y: 0.62, r: 0.048, q: 0.85, pa: 0.3,  flux: 0.80 },
    { x: 0.55, y: 0.55, r: 0.075, q: 0.50, pa: 2.2,  flux: 0.88 },
    { x: 0.81, y: 0.72, r: 0.045, q: 0.92, pa: 0.0,  flux: 0.72 },
    { x: 0.18, y: 0.82, r: 0.030, q: 1.00, pa: 0.0,  flux: 0.55 },
    { x: 0.62, y: 0.85, r: 0.040, q: 0.65, pa: 1.0,  flux: 0.65 },
  ];
  for (const g of galaxies) addGalaxy(buf, N, g);

  // A few unresolved point sources (foreground stars) for crisp PSF tells.
  const stars = [
    { x: 0.10, y: 0.50, flux: 0.95 },
    { x: 0.50, y: 0.88, flux: 0.85 },
    { x: 0.90, y: 0.18, flux: 0.80 },
  ];
  for (const s of stars) addStar(buf, N, s);

  return buf;
}

function addGalaxy(buf, N, g) {
  const cx = g.x * N, cy = g.y * N;
  const re = g.r * N;
  const cosA = Math.cos(g.pa), sinA = Math.sin(g.pa);
  const half = re * 4.5;
  const i0 = Math.max(0, Math.floor(cx - half));
  const i1 = Math.min(N - 1, Math.ceil (cx + half));
  const j0 = Math.max(0, Math.floor(cy - half));
  const j1 = Math.min(N - 1, Math.ceil (cy + half));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = i - cx, dy = j - cy;
      const u =  cosA * dx + sinA * dy;
      const v = -sinA * dx + cosA * dy;
      const r = Math.sqrt(u * u + (v * v) / (g.q * g.q));
      buf[j * N + i] += g.flux * Math.exp(-r / re);
    }
  }
}

function addStar(buf, N, s) {
  const cx = s.x * N, cy = s.y * N;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const r2 = dx * dx + dy * dy;
      const v = s.flux * Math.exp(-r2 * 0.7);
      const ii = Math.round(cx) + dx;
      const jj = Math.round(cy) + dy;
      if (ii < 0 || ii >= N || jj < 0 || jj >= N) continue;
      buf[jj * N + ii] += v;
    }
  }
}

/* ════════════════════════════════════════════════════════════════
   PSF generator (units: pixels). Defocus widens the core,
   astigmatism stretches one axis, coma adds an asymmetric tail.
   Result is normalised to unit sum so convolution preserves flux.
   ════════════════════════════════════════════════════════════════ */
function renderPSF(N, opts) {
  const { defocus = 0, astigX = 0, comaX = 0 } = opts;
  const buf = new Float32Array(N * N);
  const cx = (N - 1) / 2, cy = (N - 1) / 2;
  const sigma = 1.2 + 3.4 * defocus;
  const stretchX = 1 + astigX * 0.55;
  const stretchY = 1 - astigX * 0.35;
  let sum = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const dx = (i - cx) / sigma;
      const dy = (j - cy) / sigma;
      const r2 = (dx * dx) / (stretchX * stretchX) + (dy * dy) / (stretchY * stretchY);
      const coma = comaX * (dx * 0.4 + 0.25 * (dx * dx * dx - dx));
      const v = Math.exp(-r2) * (1 + coma);
      const value = Math.max(0, v);
      buf[j * N + i] = value;
      sum += value;
    }
  }
  if (sum > 0) for (let k = 0; k < buf.length; k++) buf[k] /= sum;
  return buf;
}

/* ════════════════════════════════════════════════════════════════
   2D convolution (zero-padded).  Cost is N² · K² per call;
   only run STATES times at module-load time, not per frame.
   ════════════════════════════════════════════════════════════════ */
function convolveField(field, N, psf, K) {
  const half = (K - 1) >> 1;
  const out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let v = 0; v < K; v++) {
        const jj = j + v - half;
        if (jj < 0 || jj >= N) continue;
        for (let u = 0; u < K; u++) {
          const ii = i + u - half;
          if (ii < 0 || ii >= N) continue;
          acc += field[jj * N + ii] * psf[v * K + u];
        }
      }
      out[j * N + i] = acc;
    }
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════
   Float-buffer → offscreen canvas.  Sequential indigo→cyan→white
   for the field; per-kernel-peak normalisation for the PSF.
   ════════════════════════════════════════════════════════════════ */
function makeFieldCanvas(data, N) {
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const ictx = c.getContext('2d');
  const id = ictx.createImageData(N, N);

  // Robust normalisation: 99.5th-percentile peak, so a single
  // bright pixel doesn't crush the rest into the noise floor.
  const sorted = Array.from(data).sort((a, b) => a - b);
  const peak = Math.max(1e-9, sorted[Math.floor(sorted.length * 0.995)]);

  for (let q = 0; q < data.length; q++) {
    const t = Math.max(0, Math.min(1, data[q] / peak));
    const r = Math.round((0.04 + t * 0.92) * 255);
    const g = Math.round((0.08 + t * 0.78) * 255);
    const b = Math.round((0.18 + t * 0.72) * 255);
    const idx = q * 4;
    id.data[idx]     = r;
    id.data[idx + 1] = g;
    id.data[idx + 2] = b;
    id.data[idx + 3] = 255;
  }
  ictx.putImageData(id, 0, 0);
  return c;
}

function makeKernelCanvas(data, N) {
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const ictx = c.getContext('2d');
  const id = ictx.createImageData(N, N);

  let peak = 0;
  for (let q = 0; q < data.length; q++) if (data[q] > peak) peak = data[q];
  if (peak === 0) peak = 1;

  for (let q = 0; q < data.length; q++) {
    const t = Math.max(0, Math.min(1, data[q] / peak));
    // Warm sequential map so PSF reads as light, distinct from the
    // cool field colormap on either side.
    const r = Math.round((0.06 + t * 0.94) * 255);
    const g = Math.round((0.04 + t * 0.78) * 255);
    const b = Math.round((0.10 + t * 0.40) * 255);
    const idx = q * 4;
    id.data[idx]     = r;
    id.data[idx + 1] = g;
    id.data[idx + 2] = b;
    id.data[idx + 3] = 255;
  }
  ictx.putImageData(id, 0, 0);
  return c;
}

/* ════════════════════════════════════════════════════════════════
   Misc helpers
   ════════════════════════════════════════════════════════════════ */
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function phaseFade(p, lo, hi) {
  if (p <= lo) return 0;
  if (p >= hi) return 1;
  return smoothstep(0, 1, (p - lo) / (hi - lo));
}
