// network.js — Act 6: simple Inception-style CNN, inference only.
// Input: a single aberrated PSF stamp.
// Output: predicted Zernike coefficients (Z₄ defocus, Z₅/Z₆ astig, Z₇/Z₈ coma, Z₁₁ spherical).
// The teaching moment is the convolution itself: a 5×5 kernel slides
// across the input, filling in a feature map cell-by-cell. Then a single
// Inception block (1×1, 3×3, 5×5 parallel branches) is drawn before the
// final regression head emits coefficient bars.
// Pure Canvas 2D, scroll-driven, no WebGL.

const ST = window.ScrollTrigger;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const container = document.getElementById('network-scene');
if (container) initNetwork(container);

function initNetwork(container) {
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

  if (fallback) fallback.style.display = 'none';

  // ─── Precompute the scene's data ──────────────────────────────
  const N_IN = 32;
  const INPUT_OPTS = { defocus: 0.45, astigX: 0.55, comaX: 0.30 };
  const INPUT = renderPSF(N_IN, INPUT_OPTS);

  // 5×5 Sobel-like horizontal-derivative kernel: produces a recognisable
  // bipolar feature map (positive on the right edge of the PSF, negative
  // on the left), so the slide animation has something legible to fill in.
  const KERNEL_5 = [
    [-1, -2,  0,  2,  1],
    [-2, -3,  0,  3,  2],
    [-3, -4,  0,  4,  3],
    [-2, -3,  0,  3,  2],
    [-1, -2,  0,  2,  1],
  ];
  const N_OUT = N_IN - 4;
  const FEAT  = convolve2D(INPUT, N_IN, KERNEL_5, 5);

  // Inception branch outputs (1×1 identity-ish, 3×3 blur, 5×5 the same edge
  // detector). Each branch's feature map is precomputed once at full extent
  // and revealed proportionally to its phase progress.
  const KERNEL_1 = [[ 1 ]];
  const KERNEL_3 = [
    [ 1, 2, 1 ],
    [ 2, 4, 2 ],
    [ 1, 2, 1 ],
  ];
  const FEAT_1 = convolve2D(INPUT, N_IN, KERNEL_1, 1);
  const FEAT_3 = convolve2D(INPUT, N_IN, KERNEL_3, 3);
  const FEAT_5 = FEAT;  // alias — same kernel as the slide demo

  // Predicted Zernike coefficients (radians of wavefront phase).
  // Truth marker added so the viewer can read residuals at a glance.
  const ZERNIKES = [
    { sym: 'Z₄',  name: 'Defocus',     pred:  0.43, truth:  0.45 },
    { sym: 'Z₅',  name: 'Astig 0°',    pred:  0.51, truth:  0.55 },
    { sym: 'Z₆',  name: 'Astig 45°',   pred: -0.06, truth: -0.05 },
    { sym: 'Z₇',  name: 'Coma X',      pred:  0.28, truth:  0.30 },
    { sym: 'Z₈',  name: 'Coma Y',      pred:  0.04, truth:  0.03 },
    { sym: 'Z₁₁', name: 'Spherical',   pred:  0.07, truth:  0.05 },
  ];

  // ─── Scroll progress ──────────────────────────────────────────
  let progress = reduceMotion ? 1 : 0;
  const trigger = ST && ST.create({
    trigger: '#network',
    start: 'top bottom',
    end:   'bottom top',
    scrub: 1,
    onUpdate: (s) => { progress = s.progress; },
  });

  let raf = 0;
  function tick() {
    ctx.clearRect(0, 0, W, H);
    drawScene(ctx, W, H, progress, {
      input: INPUT, nIn: N_IN,
      kernel: KERNEL_5, kSize: 5,
      feat: FEAT, nOut: N_OUT,
      feat1: FEAT_1, feat3: FEAT_3, feat5: FEAT_5,
      zernikes: ZERNIKES,
      vertical,
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
   Scene composition
   Four stages laid out left-to-right (or top-to-bottom on narrow):
     A. Input PSF stamp                       p ∈ [0.00, 0.18]
     B. Convolution slide → feature map       p ∈ [0.10, 0.50]
     C. Inception block (1×1, 3×3, 5×5)       p ∈ [0.45, 0.72]
     D. Regression head → Zernike bars        p ∈ [0.68, 1.00]
   ════════════════════════════════════════════════════════════════ */
function drawScene(ctx, W, H, p, S) {
  const A = phaseFade(p, 0.00, 0.18);
  const B = phaseFade(p, 0.10, 0.50);
  const C = phaseFade(p, 0.45, 0.72);
  const D = phaseFade(p, 0.68, 1.00);
  // Kernel slide proportion within phase B's window — the kernel
  // visits N_OUT² positions while filling the output map.
  const slide = phaseFade(p, 0.14, 0.46);

  const padX = 18, padY = 18;
  const innerW = W - 2 * padX;
  const innerH = H - 2 * padY;

  if (S.vertical) {
    // Stack the four stages vertically. Conv stage gets more room
    // because its slide animation is the centrepiece.
    const ratios = [0.18, 0.36, 0.22, 0.24];
    const ys = [];
    let y = padY;
    for (const r of ratios) { ys.push(y); y += r * innerH; }
    drawInputPanel    (ctx, padX, ys[0], innerW, ratios[0] * innerH, S, A);
    drawConvPanel     (ctx, padX, ys[1], innerW, ratios[1] * innerH, S, B, slide);
    drawInceptionPanel(ctx, padX, ys[2], innerW, ratios[2] * innerH, S, C);
    drawBarsPanel     (ctx, padX, ys[3], innerW, ratios[3] * innerH, S, D);
    drawArrows(ctx, padX, padY, innerW, innerH, true, [A, B, C, D], ratios);
  } else {
    const ratios = [0.16, 0.34, 0.24, 0.26];
    const xs = [];
    let x = padX;
    for (const r of ratios) { xs.push(x); x += r * innerW; }
    drawInputPanel    (ctx, xs[0], padY, ratios[0] * innerW, innerH, S, A);
    drawConvPanel     (ctx, xs[1], padY, ratios[1] * innerW, innerH, S, B, slide);
    drawInceptionPanel(ctx, xs[2], padY, ratios[2] * innerW, innerH, S, C);
    drawBarsPanel     (ctx, xs[3], padY, ratios[3] * innerW, innerH, S, D);
    drawArrows(ctx, padX, padY, innerW, innerH, false, [A, B, C, D], ratios);
  }
}

/* ────────────────────────────────────────────────────────────────
   Stage A — input PSF
   ──────────────────────────────────────────────────────────────── */
function drawInputPanel(ctx, x, y, w, h, S, fade) {
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  const { box, labelY } = panelBox(x, y, w, h, 'Aberrated PSF · 32 px');
  drawHeatmap(ctx, box.x, box.y, box.w, box.h, S.input, S.nIn, { mode: 'sequential' });
  drawPanelFrame(ctx, box.x, box.y, box.w, box.h);
  drawCaption(ctx, x + w / 2, labelY, 'Aberrated PSF · 32 px');
  ctx.restore();
}

/* ────────────────────────────────────────────────────────────────
   Stage B — convolution slide
   The kernel walks the input cell-by-cell. The output feature map
   fills in proportionally to the slide variable.
   ──────────────────────────────────────────────────────────────── */
function drawConvPanel(ctx, x, y, w, h, S, fade, slide) {
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;

  const { box, labelY } = panelBox(x, y, w, h, 'Conv 5×5');

  // Layout inside the panel: input (top-left), kernel weights (right),
  // feature map (bottom-left). Kernel sits between them.
  const innerW = box.w, innerH = box.h;
  const stampSide = Math.min(innerW * 0.55, innerH * 0.5);
  const inputX = box.x;
  const inputY = box.y;
  const featX  = box.x;
  const featY  = box.y + innerH - stampSide;
  const kernelSide = Math.min(innerW * 0.32, innerH * 0.32);
  const kernelX = box.x + innerW - kernelSide;
  const kernelY = box.y + (innerH - kernelSide) / 2;

  // Input heatmap (always full).
  drawHeatmap(ctx, inputX, inputY, stampSide, stampSide, S.input, S.nIn, { mode: 'sequential' });
  drawPanelFrame(ctx, inputX, inputY, stampSide, stampSide);

  // Kernel display (always full, but dim until phase starts).
  drawKernel(ctx, kernelX, kernelY, kernelSide, kernelSide, S.kernel, S.kSize);

  // Feature map: reveal cells in the order the kernel visits them.
  const total = S.nOut * S.nOut;
  const revealed = Math.max(0, Math.min(total, Math.floor(slide * total + 0.001)));
  drawHeatmap(ctx, featX, featY, stampSide, stampSide, S.feat, S.nOut, {
    mode: 'diverging', limit: revealed,
  });
  drawPanelFrame(ctx, featX, featY, stampSide, stampSide);

  // Sliding receptive-field marker on the input + line to current output cell.
  if (slide > 0 && slide < 1) {
    const idx = Math.min(total - 1, Math.floor(slide * total));
    const j = Math.floor(idx / S.nOut);
    const i = idx % S.nOut;

    // Receptive field on the input: a (kSize × kSize) box at (i, j).
    const cellInW = stampSide / S.nIn;
    const rfX = inputX + i * cellInW;
    const rfY = inputY + j * cellInW;
    const rfW = S.kSize * cellInW;
    ctx.strokeStyle = 'rgba(246, 192, 106, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rfX, rfY, rfW, rfW);

    // Current output cell on the feature map.
    const cellOutW = stampSide / S.nOut;
    const ocX = featX + i * cellOutW;
    const ocY = featY + j * cellOutW;
    ctx.strokeStyle = 'rgba(246, 192, 106, 0.95)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(ocX - 0.5, ocY - 0.5, cellOutW + 1, cellOutW + 1);

    // Connecting line: receptive-field centre → kernel centre → output cell.
    ctx.strokeStyle = 'rgba(246, 192, 106, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rfX + rfW / 2, rfY + rfW / 2);
    ctx.lineTo(kernelX + kernelSide / 2, kernelY + kernelSide / 2);
    ctx.lineTo(ocX + cellOutW / 2, ocY + cellOutW / 2);
    ctx.stroke();
  }

  // Tiny labels.
  drawTinyLabel(ctx, inputX, inputY - 10, 'input');
  drawTinyLabel(ctx, featX,  featY - 10, 'feature map');
  drawTinyLabel(ctx, kernelX, kernelY - 10, 'kernel');

  drawCaption(ctx, x + w / 2, labelY, 'Convolution · 5×5 kernel');
  ctx.restore();
}

/* ────────────────────────────────────────────────────────────────
   Stage C — Inception block
   Three parallel kernel-size branches fanning out from a shared
   input, each producing its own feature map; concatenated downstream.
   ──────────────────────────────────────────────────────────────── */
function drawInceptionPanel(ctx, x, y, w, h, S, fade) {
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;

  const { box, labelY } = panelBox(x, y, w, h, 'Inception block');

  const inSide  = Math.min(box.w * 0.36, box.h * 0.32);
  const inX = box.x;
  const inY = box.y + (box.h - inSide) / 2;
  drawHeatmap(ctx, inX, inY, inSide, inSide, S.input, S.nIn, { mode: 'sequential' });
  drawPanelFrame(ctx, inX, inY, inSide, inSide);
  drawTinyLabel(ctx, inX, inY - 10, 'input');

  // Three branches — kernel + output.
  const branchData = [
    { label: '1×1', kSize: 1, k: [[1]],                        feat: S.feat1, nOut: S.nIn       },
    { label: '3×3', kSize: 3, k: [[1,2,1],[2,4,2],[1,2,1]],    feat: S.feat3, nOut: S.nIn - 2  },
    { label: '5×5', kSize: 5, k: kernelSymbol5(),              feat: S.feat5, nOut: S.nIn - 4  },
  ];

  const branchAreaX = inX + inSide + 18;
  const branchAreaW = box.x + box.w - branchAreaX;
  const branchH = box.h / 3;
  const featSide = Math.min(branchH * 0.85, branchAreaW * 0.32);
  const kernelSide = Math.min(branchH * 0.55, branchAreaW * 0.18);

  ctx.strokeStyle = 'rgba(158, 197, 219, 0.45)';
  ctx.lineWidth = 1;

  branchData.forEach((b, idx) => {
    const bY = box.y + idx * branchH + (branchH - featSide) / 2;
    const kX = branchAreaX + branchAreaW * 0.20;
    const kY = box.y + idx * branchH + (branchH - kernelSide) / 2;
    const fX = branchAreaX + branchAreaW - featSide;
    const fY = bY;

    // Branch in: input → kernel.
    ctx.beginPath();
    ctx.moveTo(inX + inSide, inY + inSide / 2);
    ctx.lineTo(kX, kY + kernelSide / 2);
    ctx.stroke();

    drawKernel(ctx, kX, kY, kernelSide, kernelSide, b.k, b.kSize);
    drawTinyLabel(ctx, kX, kY - 9, b.label);

    // Branch out: kernel → output.
    ctx.beginPath();
    ctx.moveTo(kX + kernelSide, kY + kernelSide / 2);
    ctx.lineTo(fX, fY + featSide / 2);
    ctx.stroke();

    drawHeatmap(ctx, fX, fY, featSide, featSide, b.feat, b.nOut, { mode: 'diverging' });
    drawPanelFrame(ctx, fX, fY, featSide, featSide);
  });

  drawCaption(ctx, x + w / 2, labelY, 'Parallel kernels · concat');
  ctx.restore();
}

/* ────────────────────────────────────────────────────────────────
   Stage D — Zernike regression bars
   The Inception output collapses through "more blocks" (drawn as
   a faint cascading stack) into a coefficient vector; bars grow
   to their predicted values. Truth marker as a thin horizontal tick.
   ──────────────────────────────────────────────────────────────── */
function drawBarsPanel(ctx, x, y, w, h, S, fade) {
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;

  const { box, labelY } = panelBox(x, y, w, h, 'Zernike regression');

  // Faint stack at the top suggesting deeper blocks → flatten.
  const stackH = box.h * 0.18;
  const stackY = box.y;
  drawDeepStack(ctx, box.x, stackY, box.w, stackH);

  // Bars beneath the stack.
  const chartX = box.x;
  const chartY = stackY + stackH + 8;
  const chartW = box.w;
  const chartH = box.h - (stackH + 8) - 14;  // leave room for tick labels

  const n = S.zernikes.length;
  const gap = chartW * 0.04 / Math.max(1, n - 1);
  const barW = (chartW - gap * (n - 1)) / n;
  const baseY = chartY + chartH * 0.55;
  const maxAbs = 0.7;  // radians — visual scale only

  ctx.strokeStyle = 'rgba(158, 197, 219, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chartX, baseY);
  ctx.lineTo(chartX + chartW, baseY);
  ctx.stroke();

  S.zernikes.forEach((z, idx) => {
    const bx = chartX + idx * (barW + gap);
    const grow = fade;  // bars grow with phase fade
    const predH = (z.pred / maxAbs) * (chartH * 0.45) * grow;
    const truthH = (z.truth / maxAbs) * (chartH * 0.45);

    // Predicted bar.
    const fillY = predH >= 0 ? baseY - predH : baseY;
    const bh    = Math.abs(predH);
    ctx.fillStyle = z.pred >= 0
      ? 'rgba(246, 192, 106, 0.85)'
      : 'rgba(140, 178, 230, 0.85)';
    ctx.fillRect(bx, fillY, barW, bh);

    // Truth tick (thin horizontal line at z.truth).
    const truthY = baseY - truthH;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(bx - 1, truthY);
    ctx.lineTo(bx + barW + 1, truthY);
    ctx.stroke();

    // Symbol below baseline.
    drawTinyLabel(ctx, bx + barW / 2, baseY + chartH * 0.5, z.sym, { centre: true });
  });

  // Truth-tick legend.
  ctx.fillStyle = 'rgba(230, 236, 255, 0.45)';
  ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('— truth', chartX + chartW, chartY);

  drawCaption(ctx, x + w / 2, labelY, 'Predicted Zernike coefficients');
  ctx.restore();
}

/* ────────────────────────────────────────────────────────────────
   Visual primitives
   ──────────────────────────────────────────────────────────────── */
function panelBox(x, y, w, h, _title) {
  // Reserve 18 px at the bottom for the caption label.
  const labelY = y + h - 4;
  return {
    box: { x: x + 4, y: y + 6, w: w - 8, h: h - 22 },
    labelY,
  };
}

function drawPanelFrame(ctx, x, y, w, h) {
  ctx.strokeStyle = 'rgba(158, 197, 219, 0.20)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawCaption(ctx, cx, y, text) {
  ctx.fillStyle = 'rgba(230, 236, 255, 0.55)';
  ctx.font = '10.5px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text.toUpperCase(), cx, y);
}

function drawTinyLabel(ctx, x, y, text, opts = {}) {
  ctx.fillStyle = 'rgba(170, 195, 225, 0.65)';
  ctx.font = '9.5px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = opts.centre ? 'center' : 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

function drawArrows(ctx, x, y, w, h, vertical, fades, ratios) {
  // Faint arrows between adjacent stages, fading in with the
  // downstream stage's progress.
  ctx.save();
  ctx.strokeStyle = 'rgba(158, 197, 219, 0.35)';
  ctx.lineWidth = 1;
  const cumul = [];
  let acc = 0;
  for (const r of ratios) { cumul.push(acc); acc += r; }
  for (let i = 0; i < ratios.length - 1; i++) {
    const f = fades[i + 1];
    if (f <= 0) continue;
    ctx.globalAlpha = f * 0.55;
    if (vertical) {
      const yMid = y + (cumul[i] + ratios[i]) * h;
      arrow(ctx, x + w / 2, yMid - 4, x + w / 2, yMid + 6, true);
    } else {
      const xMid = x + (cumul[i] + ratios[i]) * w;
      arrow(ctx, xMid - 6, y + h / 2, xMid + 4, y + h / 2, false);
    }
  }
  ctx.restore();
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

function drawHeatmap(ctx, x, y, w, h, data, n, opts = {}) {
  const { mode = 'sequential', limit = data.length } = opts;
  const cellW = w / n;
  const cellH = h / n;
  const cap = Math.max(0, Math.min(data.length, limit));
  for (let idx = 0; idx < cap; idx++) {
    const j = (idx / n) | 0;
    const i = idx % n;
    const v = data[j * n + i];
    let r, g, b;
    if (mode === 'diverging') {
      const t = Math.max(-1, Math.min(1, v));
      if (t < 0) {
        r = 0.30 * -t * 255; g = 0.55 * -t * 255; b = 0.85 * -t * 255;
      } else {
        r = 0.95 * t * 255;  g = 0.70 * t * 255;  b = 0.30 * t * 255;
      }
    } else {
      const t = Math.max(0, Math.min(1, v));
      // Dark indigo → cyan-ish → near-white.
      r = (0.04 + t * 0.92) * 255;
      g = (0.08 + t * 0.78) * 255;
      b = (0.18 + t * 0.72) * 255;
    }
    ctx.fillStyle = `rgb(${r|0}, ${g|0}, ${b|0})`;
    ctx.fillRect(x + i * cellW, y + j * cellH, cellW + 0.6, cellH + 0.6);
  }
}

function drawKernel(ctx, x, y, w, h, kernel, k) {
  // Find peak abs value to normalise the colour stretch.
  let peak = 0;
  for (const row of kernel) for (const v of row) {
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  if (peak === 0) peak = 1;
  const cellW = w / k;
  const cellH = h / k;
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < k; i++) {
      const v = kernel[j][i] / peak;
      let r, g, b;
      if (v < 0) { r = 60 + 80 * -v; g = 110 + 90 * -v; b = 200; }
      else       { r = 230;          g = 180 + 50 * v;  b = 60 + 80 * (1 - v); }
      ctx.fillStyle = `rgb(${r|0}, ${g|0}, ${b|0})`;
      ctx.fillRect(x + i * cellW, y + j * cellH, cellW + 0.6, cellH + 0.6);
    }
  }
  ctx.strokeStyle = 'rgba(246, 192, 106, 0.85)';
  ctx.lineWidth = 1.25;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawDeepStack(ctx, x, y, w, h) {
  // A row of progressively shorter rectangles suggesting deeper
  // feature stacks before the regression head.
  const n = 6;
  const gap = 4;
  const rectW = (w - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rh = h * (1 - 0.55 * t);
    const ry = y + (h - rh) / 2;
    ctx.fillStyle = `rgba(158, 197, 219, ${0.10 + 0.18 * (1 - t)})`;
    ctx.fillRect(x + i * (rectW + gap), ry, rectW, rh);
  }
}

/* ════════════════════════════════════════════════════════════════
   Helpers — PSF generator, 2D convolution, easing
   ════════════════════════════════════════════════════════════════ */
function renderPSF(N, opts) {
  const { defocus = 0, astigX = 0, comaX = 0 } = opts;
  const buf = new Float32Array(N * N);
  const cx = (N - 1) / 2, cy = (N - 1) / 2;
  // Defocus widens the core; astig stretches one axis; coma adds an
  // asymmetric tail along +x. The whole thing is then renormalised.
  const sigma = 1.2 + 2.0 * Math.abs(defocus);
  const stretchX = 1 + astigX * 0.55;
  const stretchY = 1 - astigX * 0.35;
  let max = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const dx = (i - cx) / (N * 0.20);
      const dy = (j - cy) / (N * 0.20);
      const r2 = (dx * dx) / (stretchX * stretchX) + (dy * dy) / (stretchY * stretchY);
      const coma = comaX * (dx * 0.5 + 0.4 * (dx * dx * dx - dx));
      const v = Math.exp(-r2 / (sigma * sigma)) * (1 + coma);
      const value = Math.max(0, v);
      buf[j * N + i] = value;
      if (value > max) max = value;
    }
  }
  if (max > 0) for (let k = 0; k < buf.length; k++) buf[k] /= max;
  return buf;
}

function convolve2D(input, n, kernel, k) {
  const m = n - k + 1;
  const out = new Float32Array(m * m);
  let peak = 1e-9;
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      let acc = 0;
      for (let v = 0; v < k; v++) {
        for (let u = 0; u < k; u++) {
          acc += input[(j + v) * n + (i + u)] * kernel[v][u];
        }
      }
      out[j * m + i] = acc;
      if (Math.abs(acc) > peak) peak = Math.abs(acc);
    }
  }
  for (let q = 0; q < out.length; q++) out[q] /= peak;
  return out;
}

function kernelSymbol5() {
  return [
    [-1, -2,  0,  2,  1],
    [-2, -3,  0,  3,  2],
    [-3, -4,  0,  4,  3],
    [-2, -3,  0,  3,  2],
    [-1, -2,  0,  2,  1],
  ];
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
