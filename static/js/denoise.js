// denoise.js — Act 7: DDPM reverse-diffusion denoising of a noisy,
// undersampled raw PSF stamp before it feeds the Inception model in
// Act 8. The same clean PSF that the Network Act consumes is hidden
// behind the noise here, so the narrative thread reads: raw stamp
// → DDPM → clean → Inception → Zernike coefficients.
//
// Top row: three panels (raw input | current denoising | clean output).
// Bottom row: horizontal filmstrip of K reverse-diffusion states with
// step labels T = K-1 → 0 and a highlighted current step.
// Pure Canvas 2D.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const container = document.getElementById('denoise-scene');
if (container) initDenoise(container);

const N = 48;
const K = 10;

function initDenoise(container) {
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

  // Same clean PSF that Act 8 (Network) consumes, for narrative continuity.
  const clean = renderPSF(N, { defocus: 0.45, astigX: 0.55, comaX: 0.30 });
  const rng = mulberry32(0xDDC0DECA);
  const states = makeReverseTrajectory(clean, N, K, rng);
  const stateCanvases = states.map(s => makeStampCanvas(s, N));

  if (fallback) fallback.style.display = 'none';

  let progress = reduceMotion ? 1 : 0;
  const section = document.getElementById('denoise');
  function onScroll() {
    if (section && window.getSectionProgress)
      progress = window.getSectionProgress(section);
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  let raf = 0;
  function tick() {
    ctx.clearRect(0, 0, W, H);
    drawScene(ctx, W, H, progress, { stateCanvases, vertical });
    raf = requestAnimationFrame(tick);
  }
  tick();

  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('scroll', onScroll);
  }, { once: true });
}

/* ════════════════════════════════════════════════════════════════
   Reverse trajectory: K stamps from k=0 (noisiest) to k=K-1 (clean).
   Each stamp = clean * (1 - σ_k) + independent_noise * σ_k.
   σ_k = √t with t = 1 − k/(K−1) — approximates a DDPM cosine
   schedule and gives a perceptually smooth noise-down ramp.
   ════════════════════════════════════════════════════════════════ */
function makeReverseTrajectory(clean, N, K, rng) {
  const states = [];
  for (let k = 0; k < K; k++) {
    const t = 1 - k / (K - 1);
    const sigma = Math.sqrt(t);
    const buf = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      // Fresh noise per step — DDPM steps look distinct because their
      // residuals aren't the same noise scaled down.
      const n = (rng() - 0.5) * 2;
      buf[i] = clean[i] * (1 - sigma) + n * sigma;
    }
    states.push(buf);
  }
  return states;
}

/* ════════════════════════════════════════════════════════════════
   Scene composition.
     A. Raw input panel fades in           p ∈ [0.00, 0.18]
     B. Current denoising cross-fades      p ∈ [0.05, 0.78]
        Filmstrip fills in left-to-right
     C. Clean output appears + → CNN hint  p ∈ [0.72, 1.00]
   ════════════════════════════════════════════════════════════════ */
function drawScene(ctx, W, H, p, S) {
  const A = phaseFade(p, 0.00, 0.18);
  const C = phaseFade(p, 0.72, 1.00);

  const lerpT = phaseFade(p, 0.05, 0.78);
  const stateF = lerpT * (K - 1);
  const stateA = Math.floor(stateF);
  const stateB = Math.min(K - 1, stateA + 1);
  const blend = stateF - stateA;

  const padX = 18, padY = 18;
  const innerW = W - 2 * padX;
  const innerH = H - 2 * padY;

  if (S.vertical) {
    // Stack: input, current, output, filmstrip.
    const ratios = [0.20, 0.30, 0.20, 0.30];
    let y = padY;
    drawInputPanel  (ctx, padX, y, innerW, ratios[0] * innerH, S, A);
    y += ratios[0] * innerH;
    drawCurrentPanel(ctx, padX, y, innerW, ratios[1] * innerH, S, stateA, stateB, blend);
    y += ratios[1] * innerH;
    drawOutputPanel (ctx, padX, y, innerW, ratios[2] * innerH, S, C);
    y += ratios[2] * innerH;
    drawFilmstrip   (ctx, padX, y, innerW, ratios[3] * innerH, S, stateF, true);
  } else {
    // Top row: 3 panels.  Bottom row: filmstrip.
    const topH = innerH * 0.60;
    const botH = innerH - topH - 6;
    const topY = padY;
    const botY = padY + topH + 6;
    const colW = innerW / 3;
    drawInputPanel  (ctx, padX + 0 * colW, topY, colW, topH, S, A);
    drawCurrentPanel(ctx, padX + 1 * colW, topY, colW, topH, S, stateA, stateB, blend);
    drawOutputPanel (ctx, padX + 2 * colW, topY, colW, topH, S, C);
    drawFilmstrip   (ctx, padX, botY, innerW, botH, S, stateF, false);
  }
}

function drawInputPanel(ctx, x, y, w, h, S, fade) {
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  const { box, labelY } = panelBox(x, y, w, h);
  const side = Math.min(box.w, box.h) * 0.85;
  const px = box.x + (box.w - side) / 2;
  const py = box.y + (box.h - side) / 2;
  ctx.drawImage(S.stateCanvases[0], px, py, side, side);
  drawPanelFrame(ctx, px, py, side, side);
  drawCaption(ctx, x + w / 2, labelY, 'RAW STAMP · T = ' + (K - 1));
  ctx.restore();
}

function drawCurrentPanel(ctx, x, y, w, h, S, stateA, stateB, blend) {
  ctx.save();
  const { box, labelY } = panelBox(x, y, w, h);
  const side = Math.min(box.w, box.h) * 0.9;
  const px = box.x + (box.w - side) / 2;
  const py = box.y + (box.h - side) / 2;

  // Cross-fade between adjacent precomputed states.
  ctx.globalAlpha = 1 - blend;
  ctx.drawImage(S.stateCanvases[stateA], px, py, side, side);
  if (blend > 0) {
    ctx.globalAlpha = blend;
    ctx.drawImage(S.stateCanvases[stateB], px, py, side, side);
  }
  ctx.globalAlpha = 1;
  drawPanelFrame(ctx, px, py, side, side);

  const tStep = Math.round((K - 1) - (stateA + blend));
  drawCaption(ctx, x + w / 2, labelY, 'DENOISING · T = ' + tStep);
  ctx.restore();
}

function drawOutputPanel(ctx, x, y, w, h, S, fade) {
  ctx.save();
  const { box, labelY } = panelBox(x, y, w, h);
  const side = Math.min(box.w, box.h) * 0.85;
  const px = box.x + (box.w - side) / 2;
  const py = box.y + (box.h - side) / 2;

  if (fade <= 0) {
    // Empty frame placeholder so the user knows something is coming.
    ctx.globalAlpha = 0.35;
    drawPanelFrame(ctx, px, py, side, side);
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }

  ctx.globalAlpha = fade;
  ctx.drawImage(S.stateCanvases[K - 1], px, py, side, side);
  drawPanelFrame(ctx, px, py, side, side);
  drawCaption(ctx, x + w / 2, labelY, 'CLEAN · T = 0');

  // "→ to Inception" hint, sized to fit beside the output panel.
  ctx.fillStyle = 'rgba(246, 192, 106, 0.78)';
  ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const hintX = px + side + 8;
  if (hintX + 90 < x + w - 4) {
    ctx.fillText('→  to Inception', hintX, py + side / 2);
  }
  ctx.restore();
}

function drawFilmstrip(ctx, x, y, w, h, S, stateF, vertical) {
  ctx.save();
  const labelY = y + h - 4;

  if (vertical) {
    const cellH = (h - 22) / K;
    const cellSide = Math.min(cellH * 0.9, w * 0.5);
    const startX = x + (w - cellSide) / 2;
    for (let k = 0; k < K; k++) {
      const cy = y + k * cellH + (cellH - cellSide) / 2;
      const reveal = Math.max(0, Math.min(1, stateF - k + 1));
      ctx.globalAlpha = 0.2 + reveal * 0.8;
      ctx.drawImage(S.stateCanvases[k], startX, cy, cellSide, cellSide);
      drawFilmstripBorder(ctx, startX, cy, cellSide, k, stateF, reveal);

      // Step label to the right of each thumb.
      ctx.globalAlpha = 0.4 + reveal * 0.45;
      ctx.fillStyle = 'rgba(230, 236, 255, 0.7)';
      ctx.font = '9.5px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('T = ' + (K - 1 - k), startX + cellSide + 8, cy + cellSide / 2);
    }
  } else {
    const padInside = 6;
    const cellW = (w - padInside * 2) / K;
    const innerH = h - 22;
    const cellSide = Math.min(cellW * 0.88, innerH * 0.78);
    const startY = y + 2;
    for (let k = 0; k < K; k++) {
      const cx = x + padInside + k * cellW + (cellW - cellSide) / 2;
      const reveal = Math.max(0, Math.min(1, stateF - k + 1));
      ctx.globalAlpha = 0.2 + reveal * 0.8;
      ctx.drawImage(S.stateCanvases[k], cx, startY, cellSide, cellSide);
      drawFilmstripBorder(ctx, cx, startY, cellSide, k, stateF, reveal);
    }
    // Step labels below.
    ctx.fillStyle = 'rgba(230, 236, 255, 0.55)';
    ctx.font = '9px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let k = 0; k < K; k++) {
      const reveal = Math.max(0, Math.min(1, stateF - k + 1));
      ctx.globalAlpha = 0.35 + reveal * 0.45;
      const cx = x + padInside + k * cellW + cellW / 2;
      ctx.fillText('T=' + (K - 1 - k), cx, startY + cellSide + 4);
    }
  }
  ctx.globalAlpha = 1;
  drawCaption(ctx, x + w / 2, labelY, 'DDPM REVERSE TRAJECTORY');
  ctx.restore();
}

function drawFilmstripBorder(ctx, x, y, side, k, stateF, reveal) {
  if (Math.abs(k - stateF) < 0.5) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(246, 192, 106, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 1, y - 1, side + 2, side + 2);
  } else {
    ctx.globalAlpha = 0.2 + reveal * 0.5;
    ctx.strokeStyle = 'rgba(158, 197, 219, 0.30)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, side - 1, side - 1);
  }
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

/* ════════════════════════════════════════════════════════════════
   PSF generator + stamp-to-canvas with a diverging colormap so the
   noise (which goes negative) reads as cool tones, the signal as warm.
   ════════════════════════════════════════════════════════════════ */
function renderPSF(N, opts) {
  const { defocus = 0, astigX = 0, comaX = 0 } = opts;
  const buf = new Float32Array(N * N);
  const cx = (N - 1) / 2, cy = (N - 1) / 2;
  const sigma = 1.4 + 2.4 * Math.abs(defocus);
  const stretchX = 1 + astigX * 0.55;
  const stretchY = 1 - astigX * 0.35;
  let peak = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const dx = (i - cx) / sigma;
      const dy = (j - cy) / sigma;
      const r2 = (dx * dx) / (stretchX * stretchX) + (dy * dy) / (stretchY * stretchY);
      const coma = comaX * (dx * 0.4 + 0.25 * (dx * dx * dx - dx));
      const v = Math.exp(-r2) * (1 + coma);
      const value = Math.max(0, v);
      buf[j * N + i] = value;
      if (value > peak) peak = value;
    }
  }
  if (peak > 0) for (let k = 0; k < buf.length; k++) buf[k] /= peak;
  return buf;
}

function makeStampCanvas(data, N) {
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const ictx = c.getContext('2d');
  const id = ictx.createImageData(N, N);

  // Robust peak across |data| so a single huge noise sample doesn't
  // crush the rest of the dynamic range.
  const sorted = Array.from(data).map(Math.abs).sort((a, b) => a - b);
  const peak = Math.max(1e-9, sorted[Math.floor(sorted.length * 0.995)]);

  for (let q = 0; q < data.length; q++) {
    const v = data[q] / peak;
    let r, g, b;
    if (v >= 0) {
      // Signal: dark indigo → cyan → near-white.
      const t = Math.min(1, v);
      r = (0.04 + t * 0.92) * 255;
      g = (0.08 + t * 0.78) * 255;
      b = (0.18 + t * 0.72) * 255;
    } else {
      // Noise (negative values): cool, low-luminance violet.
      const t = Math.min(1, -v);
      r = (0.08 + t * 0.16) * 255;
      g = (0.10 + t * 0.18) * 255;
      b = (0.20 + t * 0.50) * 255;
    }
    const idx = q * 4;
    id.data[idx]     = Math.round(r);
    id.data[idx + 1] = Math.round(g);
    id.data[idx + 2] = Math.round(b);
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
