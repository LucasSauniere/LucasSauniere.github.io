// focusramp.js — Act 8 · Euclid M2 focus ramps
// Two campaigns played back-to-back by scroll progress:
//   Coarse (raw):   Δz ∈ [-50, +50] µm, step 10 µm, 3 obs/step
//   Fine:           Δz ∈ [-10, +10] µm, step  2 µm, 3 obs/step
// Model output: |Z4| (sign ambiguous due to undersampling) → V-shape.

const ST = window.ScrollTrigger;
const container = document.getElementById('focusramp-scene');
if (container) initFocusRamp(container);

function initFocusRamp(container) {
  const fallback = container.querySelector('.scene-fallback');
  if (fallback) fallback.style.display = 'none';

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
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  // ─── Campaigns ───────────────────────────────────────────────
  const BEST_FOCUS_TRUE = -3.4;   // µm — engineering best focus
  const Z4_PER_UM       = 0.030;  // waves of Z4 per µm of ΔzM2
  const FLOOR           = 0.04;   // residual |Z4| at best focus (waves)
  const OBS_PER_STEP    = 3;

  const CAMPAIGNS = [
    {
      name: 'coarse',
      steps: [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50],
      noise: 0.035,
    },
    {
      name: 'fine',
      steps: [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10],
      noise: 0.020,
    },
  ];

  // Deterministic noise per observation so scrubbing is stable.
  const RNG = mulberry32(20250510);
  for (const c of CAMPAIGNS) {
    c.noisePerObs = c.steps.map(
      () => Array.from({ length: OBS_PER_STEP }, () => (RNG() - 0.5) * 2 * c.noise)
    );
    // Precompute PSF stamps for each step in this campaign.
    c.stamps = c.steps.map((dz) => renderPSFStamp(48, dz - BEST_FOCUS_TRUE));
  }

  // ─── Scroll ──────────────────────────────────────────────────
  let progress = 0;
  const trigger = ST && ST.create({
    trigger: '#focus-ramp',
    start: 'top bottom',
    end:   'bottom top',
    scrub: 1,
    onUpdate: (s) => { progress = s.progress; },
  });

  let raf = 0;
  function tick() {
    ctx.clearRect(0, 0, W, H);
    draw(ctx, W, H, progress, {
      CAMPAIGNS, BEST_FOCUS_TRUE, Z4_PER_UM, FLOOR, OBS_PER_STEP,
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
   Composition
   ════════════════════════════════════════════════════════════════ */
function draw(ctx, W, H, progress, D) {
  // Scroll split: 0.00–0.10 intro, 0.10–0.55 coarse, 0.55–1.00 fine.
  const pIntro = smoothstep(0.00, 0.10, progress);
  const pC1    = smoothstep(0.10, 0.55, progress);
  const pC2    = smoothstep(0.55, 1.00, progress);

  // Which campaign is "current" for the left PSF panel?
  const currentC = progress < 0.55 ? 0 : 1;
  const campaign = D.CAMPAIGNS[currentC];
  const localP = currentC === 0
    ? clamp01((progress - 0.10) / 0.45)
    : clamp01((progress - 0.55) / 0.45);
  const stepFloat = localP * (campaign.steps.length - 1);
  const stepIdx = Math.min(campaign.steps.length - 1, Math.floor(stepFloat));
  const curDz = campaign.steps[stepIdx];

  // Layout.
  const padX = 24, padY = 22, gap = 20;
  const vertical = W < 720;
  const leftW  = vertical ? W - padX * 2 : Math.round((W - padX * 2 - gap) * 0.38);
  const leftH  = vertical ? Math.round(H * 0.34) : H - padY * 2;
  const rightX = vertical ? padX : padX + leftW + gap;
  const rightY = vertical ? padY + leftH + gap : padY;
  const rightW = vertical ? W - padX * 2 : W - padX * 2 - leftW - gap;
  const rightH = vertical ? H - leftH - gap - padY * 2 : H - padY * 2;

  drawPSFPanel(ctx, padX, padY, leftW, leftH, campaign, stepIdx, curDz, currentC);
  drawPlotsPanel(ctx, rightX, rightY, rightW, rightH, D, pC1, pC2, stepFloat, currentC);
}

/* ─── Left: current PSF + ramp strip ────────────────────────── */
function drawPSFPanel(ctx, x, y, w, h, campaign, stepIdx, curDz, campaignIdx) {
  ctx.fillStyle = 'rgba(10, 16, 28, 0.9)';
  ctx.strokeStyle = 'rgba(140, 180, 220, 0.3)';
  roundRect(ctx, x, y, w, h, 6); ctx.fill(); ctx.stroke();

  ctx.fillStyle = 'rgba(220, 230, 250, 0.9)';
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`PSF · ${campaignIdx === 0 ? 'coarse' : 'fine'} ramp`, x + 10, y + 8);

  ctx.fillStyle = 'rgba(170, 195, 225, 0.7)';
  ctx.font = '500 10px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`ΔzM2 = ${curDz >= 0 ? '+' : ''}${curDz} µm`, x + w - 10, y + 8);

  // PSF image.
  const top = y + 30, bot = y + h - 42;
  const imgSize = Math.min(w - 20, bot - top);
  const ix = x + (w - imgSize) / 2;
  const iy = top + ((bot - top) - imgSize) / 2;

  const stamp = campaign.stamps[stepIdx];
  const N = stamp.N;
  const img = ctx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const u = Math.pow(clamp01(Math.log(1 + stamp.values[i] / stamp.peak * 400) / Math.log(401)), 0.5);
    const [r, g, b] = inferno(u);
    img.data[i * 4    ] = r * 255;
    img.data[i * 4 + 1] = g * 255;
    img.data[i * 4 + 2] = b * 255;
    img.data[i * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas');
  tmp.width = N; tmp.height = N;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.save();
  roundRect(ctx, ix, iy, imgSize, imgSize, 4); ctx.clip();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmp, ix, iy, imgSize, imgSize);
  ctx.restore();

  // Ramp strip.
  const stripY = y + h - 24;
  const stripX = x + 14;
  const stripW = w - 28;
  ctx.fillStyle = 'rgba(170, 195, 225, 0.5)';
  ctx.font = '500 9px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`${campaign.name} · step ${stepIdx + 1}/${campaign.steps.length}`, stripX, stripY - 10);

  ctx.strokeStyle = 'rgba(140, 180, 220, 0.35)';
  ctx.beginPath(); ctx.moveTo(stripX, stripY); ctx.lineTo(stripX + stripW, stripY); ctx.stroke();

  const mn = campaign.steps[0], mx = campaign.steps[campaign.steps.length - 1];
  for (let i = 0; i < campaign.steps.length; i++) {
    const u = (campaign.steps[i] - mn) / (mx - mn);
    const cx = stripX + u * stripW;
    const isCur = i === stepIdx;
    ctx.beginPath();
    ctx.arc(cx, stripY, isCur ? 4 : 2.2, 0, Math.PI * 2);
    ctx.fillStyle = isCur ? 'rgba(240, 200, 120, 0.95)' : 'rgba(160, 185, 215, 0.55)';
    ctx.fill();
  }
}

/* ─── Right: two plots, coarse then fine ────────────────────── */
function drawPlotsPanel(ctx, x, y, w, h, D, pC1, pC2, stepFloat, activeIdx) {
  // Two stacked plots.
  const headerH = 0;
  const plotH = (h - 12) / 2;
  drawCampaignPlot(ctx, x, y,             w, plotH, D, 0, activeIdx === 0 ? stepFloat : null, pC1);
  drawCampaignPlot(ctx, x, y + plotH + 12, w, plotH, D, 1, activeIdx === 1 ? stepFloat : null, pC2);
}

function drawCampaignPlot(ctx, x, y, w, h, D, campaignIdx, stepFloat, revealP) {
  const campaign = D.CAMPAIGNS[campaignIdx];

  ctx.fillStyle = 'rgba(10, 16, 28, 0.9)';
  ctx.strokeStyle = 'rgba(140, 180, 220, 0.3)';
  roundRect(ctx, x, y, w, h, 6); ctx.fill(); ctx.stroke();

  ctx.fillStyle = 'rgba(220, 230, 250, 0.9)';
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(
    `${campaignIdx === 0 ? 'Coarse ramp' : 'Fine ramp'}  ·  |Z₄|  vs  ΔzM2`,
    x + 10, y + 8
  );

  // Plot area.
  const plotX = x + 46;
  const plotY = y + 32;
  const plotW = w - 56;
  const plotH = h - 60;

  const stepsArr = campaign.steps;
  const dzMin = stepsArr[0] - (stepsArr[1] - stepsArr[0]);
  const dzMax = stepsArr[stepsArr.length - 1] + (stepsArr[1] - stepsArr[0]);
  const yModel = (dz) => Math.abs(D.Z4_PER_UM * (dz - D.BEST_FOCUS_TRUE)) + D.FLOOR;
  const yMax = Math.max(yModel(dzMin), yModel(dzMax)) * 1.15;

  const xOf = (dz) => plotX + (dz - dzMin) / (dzMax - dzMin) * plotW;
  const yOf = (v)  => plotY + (1 - v / yMax) * plotH;

  // Gridlines.
  ctx.strokeStyle = 'rgba(140, 180, 220, 0.10)';
  for (let i = 0; i <= 4; i++) {
    const yy = plotY + (i / 4) * plotH;
    ctx.beginPath(); ctx.moveTo(plotX, yy); ctx.lineTo(plotX + plotW, yy); ctx.stroke();
  }

  // Axes.
  ctx.strokeStyle = 'rgba(160, 185, 215, 0.5)';
  ctx.beginPath();
  ctx.moveTo(plotX, plotY); ctx.lineTo(plotX, plotY + plotH);
  ctx.lineTo(plotX + plotW, plotY + plotH);
  ctx.stroke();

  // Axis labels.
  ctx.fillStyle = 'rgba(170, 195, 225, 0.7)';
  ctx.font = '500 9px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ΔzM2 [µm]', plotX + plotW / 2, y + h - 8);
  ctx.save();
  ctx.translate(x + 14, plotY + plotH / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('|Z₄| [waves]', 0, 0);
  ctx.restore();

  // Tick labels on x-axis.
  ctx.fillStyle = 'rgba(160, 185, 215, 0.6)';
  ctx.textAlign = 'center';
  const tickSet = campaignIdx === 0 ? [-50, -25, 0, 25, 50] : [-10, -5, 0, 5, 10];
  for (const dz of tickSet) {
    ctx.fillText(`${dz > 0 ? '+' : ''}${dz}`, xOf(dz), plotY + plotH + 12);
  }

  // Scatter: reveal points according to revealP (for active campaign)
  // or fully (for the other campaign once its turn has passed).
  const revealed = stepFloat === null
    ? (campaignIdx === 0 ? (revealP >= 1 ? stepsArr.length : 0)
                          : (revealP > 0 ? Math.floor(revealP * stepsArr.length) : 0))
    : Math.min(stepsArr.length, Math.floor(stepFloat) + 1);

  const fitPts = [];
  for (let s = 0; s < revealed; s++) {
    const dz = stepsArr[s];
    const trueVal = yModel(dz);
    const alpha = (stepFloat !== null && s === revealed - 1)
      ? smoothstep(0, 1, stepFloat - s)
      : 0.85;
    for (let k = 0; k < D.OBS_PER_STEP; k++) {
      const y4 = Math.max(0, trueVal + campaign.noisePerObs[s][k]);
      ctx.beginPath();
      ctx.arc(xOf(dz), yOf(y4), 2.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(120, 180, 240, ${0.6 * alpha})`;
      ctx.fill();
      fitPts.push([dz, y4]);
    }
  }

  // V-shape fit once we have enough points.
  if (fitPts.length >= 6) {
    const fit = fitVShape(fitPts, dzMin, dzMax);
    const fitAlpha = smoothstep(6, 15, fitPts.length);

    // Plot fit as two segments meeting at (x0, b).
    ctx.strokeStyle = `rgba(240, 200, 120, ${0.85 * fitAlpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xOf(dzMin), yOf(fit.a * Math.abs(dzMin - fit.x0) + fit.b));
    ctx.lineTo(xOf(fit.x0), yOf(fit.b));
    ctx.lineTo(xOf(dzMax), yOf(fit.a * Math.abs(dzMax - fit.x0) + fit.b));
    ctx.stroke();

    const showMarkers = fitPts.length >= (campaignIdx === 0 ? 15 : 12);
    if (showMarkers) {
      const mA = smoothstep(15, 24, fitPts.length);

      // Engineering best focus — dashed green.
      ctx.strokeStyle = `rgba(180, 220, 180, ${0.8 * mA})`;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(xOf(D.BEST_FOCUS_TRUE), plotY);
      ctx.lineTo(xOf(D.BEST_FOCUS_TRUE), plotY + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Recovered vertex — solid amber.
      ctx.strokeStyle = `rgba(240, 200, 120, ${0.95 * mA})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xOf(fit.x0), plotY);
      ctx.lineTo(xOf(fit.x0), plotY + plotH);
      ctx.stroke();

      // Readouts — absolute and normalised Δ.
      const stepSize = Math.abs(stepsArr[1] - stepsArr[0]);
      const dAbs = fit.x0 - D.BEST_FOCUS_TRUE;
      const dNorm = dAbs / stepSize;

      ctx.fillStyle = `rgba(200, 215, 240, ${0.9 * mA})`;
      ctx.font = '600 10px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(
        `recovered = ${fit.x0.toFixed(2)} µm   eng = ${D.BEST_FOCUS_TRUE.toFixed(2)} µm`,
        plotX, plotY - 6
      );
      ctx.textAlign = 'right';
      ctx.fillText(
        `Δ = ${dAbs >= 0 ? '+' : ''}${dAbs.toFixed(2)} µm   (${dNorm >= 0 ? '+' : ''}${dNorm.toFixed(2)} × step)`,
        plotX + plotW, plotY - 6
      );
    }
  }
}

/* V-shape fit:  y = a · |x − x0| + b
   Grid-search x0 in [xMin, xMax]; closed-form (a, b) for each. */
function fitVShape(pts, xMin, xMax) {
  const N = 401;
  let best = { sse: Infinity, x0: 0, a: 0, b: 0 };
  for (let i = 0; i < N; i++) {
    const x0 = xMin + (xMax - xMin) * i / (N - 1);
    let sU = 0, sY = 0, sUU = 0, sUY = 0;
    for (const [x, y] of pts) {
      const u = Math.abs(x - x0);
      sU += u; sY += y; sUU += u * u; sUY += u * y;
    }
    const n = pts.length;
    const denom = n * sUU - sU * sU;
    if (denom < 1e-9) continue;
    const a = (n * sUY - sU * sY) / denom;
    const b = (sY - a * sU) / n;
    if (a < 0) continue;              // V opens upward
    let sse = 0;
    for (const [x, y] of pts) {
      const r = y - (a * Math.abs(x - x0) + b);
      sse += r * r;
    }
    if (sse < best.sse) best = { sse, x0, a, b };
  }
  return best;
}

/* ─── PSF stamp renderer (simple Gaussian × Airy proxy) ────── */
// Full diffraction would be correct but overkill here — this
// reproduces the symmetric broadening that matters for the story.
function renderPSFStamp(N, defocusSigned) {
  const vals = new Float32Array(N * N);
  const cx = (N - 1) / 2, cy = (N - 1) / 2;
  const coreSigma = 0.85;
  const broaden = Math.abs(defocusSigned) * 0.14;
  const sigma = Math.hypot(coreSigma, broaden);
  let peak = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy);
      // Airy-ish core + defocus halo.
      const core = Math.exp(-0.5 * (r / sigma) ** 2);
      const ring = Math.abs(defocusSigned) > 6
        ? 0.25 * Math.exp(-0.5 * ((r - broaden * 2) / (sigma * 0.6)) ** 2)
        : 0;
      const v = core + ring;
      vals[y * N + x] = v;
      if (v > peak) peak = v;
    }
  }
  return { values: vals, peak: peak || 1, N };
}

/* ─── utils (duplicated here so file is standalone) ──────────── */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function inferno(t) {
  const s = [
    [0.00, [0.001, 0.000, 0.014]],
    [0.25, [0.258, 0.039, 0.406]],
    [0.50, [0.580, 0.148, 0.404]],
    [0.75, [0.865, 0.316, 0.226]],
    [1.00, [0.988, 1.000, 0.644]],
  ];
  t = clamp01(t);
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i][0]) {
      const [t0, c0] = s[i - 1], [t1, c1] = s[i];
      const k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k,
              c0[1] + (c1[1] - c0[1]) * k,
              c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return s[s.length - 1][1];
}