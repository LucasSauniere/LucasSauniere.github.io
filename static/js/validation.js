// validation.js — Act 7: held-out star, residual, and focal-plane error map.
// All three panels share the same scroll-driven "training progress" variable.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const container = document.getElementById('validation-scene');
if (container) initValidation(container);

function initValidation(container) {
  const fallback = container.querySelector('.scene-fallback');
  const canvas = document.createElement('canvas');
  canvas.className = 'scene-canvas';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  let W = 0, H = 0;
  function resize() {
    const r = container.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ─── Precompute the held-out star + a sequence of predictions ────
  // The network "learns" over a fake training schedule; we precompute
  // one truth stamp and a handful of prediction stamps of increasing
  // quality, then blend between them based on scroll progress.
  const TRUTH  = renderPSFStamp(64, TRUTH_OPTS);
  const PREDS  = PRED_SCHEDULE.map((opts) => renderPSFStamp(64, opts));

  // Focal-plane error grid: 9×6 tiles, each a dT/T value that shrinks
  // as training progresses (except for a few "hot" tiles that remain).
  const GRID = buildErrorGrid(9, 6);

  // ─── Scroll progress ─────────────────────────────────────────
  let progress = 0;
  const section = document.getElementById('validation');
  function onScroll() {
    if (section && window.getSectionProgress)
      progress = window.getSectionProgress(section);
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  let raf = 0;
  function tick() {
    ctx.clearRect(0, 0, W, H);

    // Convert scroll progress into "training progress" on [0, 1],
    // with most of the interesting behaviour in [0.2, 0.8].
    const t = smoothstep(0.15, 0.85, progress);

    drawValidation(ctx, W, H, t, TRUTH, PREDS, GRID);

    raf = requestAnimationFrame(tick);
  }
  if (fallback) fallback.style.display = 'none';
  tick();

  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('scroll', onScroll);
  }, { once: true });
}

/* ════════════════════════════════════════════════════════════════
   Top-level composition
   ════════════════════════════════════════════════════════════════ */
function drawValidation(ctx, W, H, t, truth, preds, grid) {
  const padX = 24;
  const padY = 20;
  const gap  = 16;

  // Three equal panels for truth / pred / residual, and one wide
  // panel below for the focal-plane error map.
  const vertical = W < 640;
  const topH = vertical ? Math.round(H * 0.38) : Math.round(H * 0.45);
  const botH = H - topH - padY * 2 - gap;

  const panelW = vertical
    ? (W - padX * 2)
    : (W - padX * 2 - gap * 2) / 3;
  const panelH = vertical
    ? Math.round(topH / 3) - 4
    : topH;

  // Current prediction (blended between snapshots).
  const blend = t * (preds.length - 1);
  const idxA = Math.floor(blend);
  const idxB = Math.min(preds.length - 1, idxA + 1);
  const f = blend - idxA;

  // Three panels.
  const panels = [
    { label: 'Truth',      kind: 'truth',    x: padX,                      y: padY },
    { label: 'Prediction', kind: 'pred',     x: padX + panelW + gap,       y: padY },
    { label: 'Residual',   kind: 'residual', x: padX + (panelW + gap) * 2, y: padY },
  ];
  if (vertical) {
    panels[0].x = padX; panels[0].y = padY;
    panels[1].x = padX; panels[1].y = padY + panelH + 4;
    panels[2].x = padX; panels[2].y = padY + (panelH + 4) * 2;
  }

  for (const p of panels) {
    drawPanel(ctx, p, panelW, panelH, truth, preds, idxA, idxB, f, t);
  }

  // Training readout, between the panels and the map.
  const readoutY = padY + topH + 6;
  drawReadout(ctx, padX, readoutY, W - padX * 2, t);

  // Focal-plane error map.
  const mapY = readoutY + 22;
  const mapH = H - mapY - padY;
  drawErrorMap(ctx, padX, mapY, W - padX * 2, mapH, grid, t);
}

/* ════════════════════════════════════════════════════════════════
   Panels: truth, prediction, residual
   ════════════════════════════════════════════════════════════════ */
function drawPanel(ctx, panel, w, h, truth, preds, idxA, idxB, f, t) {
  const { x, y, label, kind } = panel;

  // Background.
  ctx.save();
  ctx.fillStyle = 'rgba(10, 16, 28, 0.9)';
  ctx.strokeStyle = 'rgba(140, 180, 220, 0.3)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Clipped image area (leave room for label on top, scale bar bottom).
  const imgY = y + 20, imgH = h - 40;
  const imgX = x + 8,  imgW = w - 16;
  const size = Math.min(imgW, imgH);
  const ix = imgX + (imgW - size) / 2;
  const iy = imgY + (imgH - size) / 2;

  ctx.save();
  roundRect(ctx, ix, iy, size, size, 4);
  ctx.clip();
  drawPanelContent(ctx, kind, ix, iy, size, truth, preds, idxA, idxB, f, t);
  ctx.restore();

  // Label.
  ctx.fillStyle = 'rgba(220, 230, 250, 0.9)';
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label, x + 10, y + 6);

  // Panel-specific caption.
  ctx.fillStyle = 'rgba(170, 195, 225, 0.6)';
  ctx.font = '500 9px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'right';
  const cap = kind === 'residual'
    ? `pred − truth · ±5%`
    : kind === 'pred'
      ? `epoch ${Math.round(t * 300)}`
      : `held-out star`;
  ctx.fillText(cap, x + w - 10, y + 6);

  // Colour scale strip at bottom of panel.
  drawScaleStrip(ctx, x + 10, y + h - 14, w - 20, 6, kind);
}

function drawPanelContent(ctx, kind, x, y, size, truth, preds, idxA, idxB, f, t) {
  const N = 64;
  const predA = preds[idxA], predB = preds[idxB];

  // Build per-pixel data for the current panel.
  const data = new Float32Array(N * N);
  if (kind === 'truth') {
    for (let i = 0; i < N * N; i++) data[i] = truth.values[i];
  } else if (kind === 'pred') {
    for (let i = 0; i < N * N; i++) {
      data[i] = predA.values[i] * (1 - f) + predB.values[i] * f;
    }
  } else {
    // Residual = pred - truth, with a residual noise floor that persists.
    // Even at t=1, photon noise contributes ~ sqrt(pred) / gain.
    for (let i = 0; i < N * N; i++) {
      const pred = predA.values[i] * (1 - f) + predB.values[i] * f;
      data[i] = pred - truth.values[i];
    }
  }

  // Stretch per panel kind.
  const img = ctx.createImageData(N, N);
  if (kind === 'residual') {
    // Diverging RdBu around 0, scaled to ±5% of truth peak.
    const scale = 0.05 * truth.peak;
    for (let i = 0; i < N * N; i++) {
      const v = data[i] / scale;        // in roughly [-1, 1]
      const [r, g, b] = divergingRdBu(clamp(-1, 1, v));
      img.data[i * 4    ] = r * 255;
      img.data[i * 4 + 1] = g * 255;
      img.data[i * 4 + 2] = b * 255;
      img.data[i * 4 + 3] = 255;
    }
  } else {
    // Truth/pred: inferno with log stretch, normalised to truth peak.
    const peak = truth.peak;
    for (let i = 0; i < N * N; i++) {
      const v = Math.pow(clamp01(Math.log(1 + Math.max(0, data[i]) / peak * 300) / Math.log(301)), 0.5);
      const [r, g, b] = inferno(v);
      img.data[i * 4    ] = r * 255;
      img.data[i * 4 + 1] = g * 255;
      img.data[i * 4 + 2] = b * 255;
      img.data[i * 4 + 3] = 255;
    }
  }

  // Draw via an offscreen canvas so we can scale smoothly.
  const tmp = document.createElement('canvas');
  tmp.width = N; tmp.height = N;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmp, x, y, size, size);
}

function drawScaleStrip(ctx, x, y, w, h, kind) {
  const n = 120;
  const img = ctx.createImageData(n, 1);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let rgb;
    if (kind === 'residual') {
      rgb = divergingRdBu(2 * t - 1);
    } else {
      rgb = inferno(t);
    }
    img.data[i * 4    ] = rgb[0] * 255;
    img.data[i * 4 + 1] = rgb[1] * 255;
    img.data[i * 4 + 2] = rgb[2] * 255;
    img.data[i * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas');
  tmp.width = n; tmp.height = 1;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.drawImage(tmp, x, y, w, h);
}

/* ════════════════════════════════════════════════════════════════
   Training readout
   ════════════════════════════════════════════════════════════════ */
function drawReadout(ctx, x, y, w, t) {
  const epoch  = Math.round(t * 300);
  // χ² per pixel decays from ~6 to ~1.05; never exactly 1 (noise floor).
  const chi2   = 1.05 + 5.0 * Math.exp(-t * 3.2);
  // Fractional size error decays from ~1e-2 to ~5e-4.
  const dT     = 1e-2 * Math.exp(-t * 3.0) + 5e-4;

  ctx.save();
  ctx.font = '600 10px ui-monospace, Menlo, monospace';
  ctx.fillStyle = 'rgba(200, 215, 240, 0.85)';
  ctx.textBaseline = 'top';

  const items = [
    `epoch   ${String(epoch).padStart(4, ' ')}`,
    `χ²/pix  ${chi2.toFixed(2)}`,
    `ΔT/T    ${dT.toExponential(1)}`,
  ];
  const colW = w / items.length;
  for (let i = 0; i < items.length; i++) {
    ctx.fillStyle = 'rgba(170, 195, 225, 0.5)';
    ctx.textAlign = 'left';
    const key = items[i].slice(0, 7);
    const val = items[i].slice(7).trim();
    ctx.fillText(key, x + i * colW + 8, y + 4);
    ctx.fillStyle = 'rgba(240, 230, 200, 0.95)';
    ctx.textAlign = 'right';
    ctx.fillText(val, x + (i + 1) * colW - 8, y + 4);
  }

  // Progress bar under the row.
  ctx.fillStyle = 'rgba(140, 180, 220, 0.15)';
  ctx.fillRect(x, y + 18, w, 2);
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, 'rgba(120, 180, 240, 0.9)');
  grad.addColorStop(1, 'rgba(230, 180, 110, 0.9)');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y + 18, w * t, 2);
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════
   Focal-plane error map
   ════════════════════════════════════════════════════════════════ */
function buildErrorGrid(cols, rows) {
  // Each tile has (initial error, final error). Final is small for most,
  // but a few "hot" tiles retain noticeable residuals.
  const rng = mulberry32(4242);
  const cells = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // Distance from centre → larger initial error at the edges
      // (vignetting, off-axis aberrations, etc.).
      const u = (i + 0.5) / cols - 0.5;
      const v = (j + 0.5) / rows - 0.5;
      const rad = Math.sqrt(u * u + v * v) / 0.7;
      const init = (0.006 + 0.015 * rad) * (0.7 + 0.6 * rng());

      // A couple of "hot" tiles that converge more slowly.
      const isHot = (i === cols - 1 && j === rows - 2) ||
                    (i === 1 && j === 0) ||
                    (i === 4 && j === rows - 1);
      const final = isHot ? 1.5e-3 + 1e-3 * rng() : 3e-4 * rng();

      // Sign (residuals can be + or -).
      const sign = rng() > 0.5 ? 1 : -1;

      cells.push({ i, j, init: init * sign, final: final * sign, hot: isHot });
    }
  }
  return { cols, rows, cells };
}

function drawErrorMap(ctx, x, y, w, h, grid, t) {
  ctx.save();

  // Container.
  ctx.fillStyle = 'rgba(10, 16, 28, 0.85)';
  ctx.strokeStyle = 'rgba(140, 180, 220, 0.3)';
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();

  // Title.
  ctx.fillStyle = 'rgba(220, 230, 250, 0.9)';
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Fractional size error  ΔT/T   across focal plane', x + 10, y + 6);

  // Draw cells.
  const mapX = x + 14;
  const mapY = y + 26;
  const mapW = w - 28;
  const mapH = h - 40;
  const cw = mapW / grid.cols;
  const ch = mapH / grid.rows;

  // Max absolute value for colour scaling: fixed at 2e-2 so the early
  // state really looks bad and the late state really looks clean.
  const vmax = 2e-2;

  for (const c of grid.cells) {
    const v = c.init * (1 - t) + c.final * t;
    const norm = clamp(-1, 1, v / vmax);
    const [r, g, b] = divergingRdBu(norm);
    ctx.fillStyle = `rgb(${r * 255}, ${g * 255}, ${b * 255})`;
    ctx.fillRect(mapX + c.i * cw + 1, mapY + c.j * ch + 1, cw - 2, ch - 2);

    // Hot-cell annotation once training has "finished" enough to see them.
    if (c.hot && t > 0.7) {
      const a = smoothstep(0.7, 0.9, t);
      ctx.strokeStyle = `rgba(255, 240, 200, ${0.9 * a})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(mapX + c.i * cw + 1, mapY + c.j * ch + 1, cw - 2, ch - 2);
    }
  }

  // Axis labels (chip corners).
  ctx.fillStyle = 'rgba(160, 185, 215, 0.55)';
  ctx.font = '500 9px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('u = −1', mapX, mapY + mapH + 2);
  ctx.textAlign = 'right';
  ctx.fillText('u = +1', mapX + mapW, mapY + mapH + 2);

  // Hot-spot callout (late in training).
  if (t > 0.85) {
    const a = smoothstep(0.85, 0.98, t);
    ctx.fillStyle = `rgba(255, 220, 160, ${0.85 * a})`;
    ctx.font = '500 9px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('↑ residuals near bright-star spikes', x + w - 12, y + h - 14);
  }

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════
   PSF stamp generation (reused from earlier acts, with extras)
   ════════════════════════════════════════════════════════════════ */
const TRUTH_OPTS = {
  defocus: 0.18, astigX: 0.14, astigY: -0.09,
  comaX:   0.07, comaY:   0.03, spherical: 0.10,
  trefX:   0.04, jitter:  0.3,
  noise:   0.0, seed: 9,
};

// A schedule of predictions: early predictions are oversimplified
// (isotropic Gaussian-ish), later predictions approach truth.
const PRED_SCHEDULE = [
  // Epoch ~1: barely more than a Gaussian.
  { ...TRUTH_OPTS, astigX: 0.0,  astigY: 0.0,  comaX: 0, comaY: 0,
    spherical: 0.0, trefX: 0, jitter: 1.2, defocus: 0.25, noise: 0.0, seed: 1 },
  // Epoch ~20: some aberrations, wrong magnitudes.
  { ...TRUTH_OPTS, astigX: 0.05, astigY: -0.02, comaX: 0.02, comaY: 0.01,
    spherical: 0.04, trefX: 0.01, jitter: 0.7, noise: 0.0, seed: 2 },
  // Epoch ~80: mostly there, small errors.
  { ...TRUTH_OPTS, astigX: 0.11, astigY: -0.07, comaX: 0.05, comaY: 0.025,
    spherical: 0.08, trefX: 0.03, jitter: 0.45, noise: 0.0, seed: 3 },
  // Epoch ~200: excellent, with noise-floor-level differences.
  { ...TRUTH_OPTS, astigX: 0.135, astigY: -0.086, comaX: 0.065, comaY: 0.028,
    spherical: 0.095, trefX: 0.038, jitter: 0.32, noise: 0.0, seed: 4 },
  // Epoch ~300: converged.
  { ...TRUTH_OPTS, jitter: 0.30, seed: 5 },
];

function renderPSFStamp(N, opts) {
  const re = new Float32Array(N * N);
  const im = new Float32Array(N * N);
  const cx = N / 2, cy = N / 2, R = N * 0.22, obs = 0.32;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x - cx) / R, dy = (y - cy) / R;
      const rho = Math.sqrt(dx * dx + dy * dy);
      if (rho <= 1 && rho >= obs) {
        const th = Math.atan2(dy, dx);
        const r2 = rho * rho, r3 = r2 * rho, r4 = r2 * r2;
        let phi = 0;
        phi += opts.defocus   * (2 * r2 - 1);
        phi += opts.astigX    * r2 * Math.cos(2 * th);
        phi += opts.astigY    * r2 * Math.sin(2 * th);
        phi += (opts.comaX||0)* (3 * r3 - 2 * rho) * Math.cos(th);
        phi += (opts.comaY||0)* (3 * r3 - 2 * rho) * Math.sin(th);
        phi += (opts.spherical||0) * (6 * r4 - 6 * r2 + 1);
        phi += (opts.trefX||0) * r3 * Math.cos(3 * th);
        re[y * N + x] = Math.cos(phi);
        im[y * N + x] = Math.sin(phi);
      }
    }
  }
  fft2D(re, im, N);

  const values = new Float32Array(N * N);
  let peak = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const sx = (x + N / 2) % N, sy = (y + N / 2) % N;
      const k = sy * N + sx;
      const v = re[k] * re[k] + im[k] * im[k];
      values[y * N + x] = v;
      if (v > peak) peak = v;
    }
  }

  // Apply Gaussian jitter (convolution in image space).
  if (opts.jitter > 0) {
    applyGaussianBlur(values, N, N, opts.jitter);
    // Recompute peak after blur.
    peak = 0;
    for (let i = 0; i < values.length; i++) if (values[i] > peak) peak = values[i];
  }

  return { values, peak, N };
}

function applyGaussianBlur(arr, W, H, sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const k = Math.exp(-0.5 * (i * i) / (sigma * sigma));
    kernel[i + radius] = k;
    sum += k;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const tmp = new Float32Array(arr.length);
  // Horizontal.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -radius; i <= radius; i++) {
        const xi = Math.min(W - 1, Math.max(0, x + i));
        v += arr[y * W + xi] * kernel[i + radius];
      }
      tmp[y * W + x] = v;
    }
  }
  // Vertical.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -radius; i <= radius; i++) {
        const yi = Math.min(H - 1, Math.max(0, y + i));
        v += tmp[yi * W + x] * kernel[i + radius];
      }
      arr[y * W + x] = v;
    }
  }
}

/* ════════════════════════════════════════════════════════════════
   Utilities (colour maps, FFT, misc)
   ════════════════════════════════════════════════════════════════ */
function divergingRdBu(t) {
  // t in [-1, 1]: blue for negative, white near zero, red for positive.
  const a = Math.abs(t);
  if (t >= 0) {
    return [1.0 - 0.25 * a, 1.0 - 0.75 * a, 1.0 - 0.85 * a];
  } else {
    return [1.0 - 0.85 * a, 1.0 - 0.70 * a, 1.0 - 0.20 * a];
  }
}

function inferno(t) {
  t = clamp01(t);
  const r = 0.0002189 + t * (0.1065 + t * (11.60 + t * (-41.70 + t * (77.16 + t * (-71.32 + t * 25.13)))));
  const g = 0.001651 + t * (0.5639 + t * (-3.972 + t * (17.43 + t * (-33.40 + t * (32.62 + t * -12.24)))));
  const b = -0.01986 + t * (3.933 + t * (-15.94 + t * (44.35 + t * (-81.80 + t * (73.21 + t * -23.07)))));
  return [clamp01(r), clamp01(g), clamp01(b)];
}

function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function clamp(a, b, x) { return x < a ? a : x > b ? b : x; }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

function mulberry32(seed) {
  let t = seed | 0;
  return function () {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function fft1D(re, im, off, stride, n) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = off + i * stride, b = off + j * stride;
      const tr = re[a]; re[a] = re[b]; re[b] = tr;
      const ti = im[a]; im[a] = im[b]; im[b] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wlr = Math.cos(ang), wli = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let k = 0; k < half; k++) {
        const a = off + (i + k) * stride;
        const b = off + (i + k + half) * stride;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] = re[a] + xr; im[a] = im[a] + xi;
        const nwr = wr * wlr - wi * wli;
        wi = wr * wli + wi * wlr;
        wr = nwr;
      }
    }
  }
}
function fft2D(re, im, N) {
  for (let y = 0; y < N; y++) fft1D(re, im, y * N, 1, N);
  for (let x = 0; x < N; x++) fft1D(re, im, x, N, N);
}