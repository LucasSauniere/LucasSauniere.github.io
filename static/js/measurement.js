// measurement.js — Act 5: focal-plane PSF tour.
// Canvas 2D rendering, because this view is fundamentally flat and we want
// crisp pixel-level detail for the final PSF close-up.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const container = document.getElementById('measurement-scene');
if (container) initMeasurement(container);

function initMeasurement(container) {
  const fallbackEl = container.querySelector('.scene-fallback');
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
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ─── Focal plane layout (Euclid VIS: 6×6 CCDs with small inter-CCD gaps) ───
  const GRID = 6;
  const CCD_STARS = buildStarCatalog(3800); // normalised [0,1]² positions

  // ─── Precomputed PSF stamps (one per CCD, 48×48) ───
  const STAMP_N = 48;
  const stamps = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      // Field position in [-1, 1].
      const fx = (i + 0.5) / GRID * 2 - 1;
      const fy = (j + 0.5) / GRID * 2 - 1;
      stamps.push(buildPsfStamp(STAMP_N, fx, fy));
    }
  }

  // ─── Scroll progress ───
  let progress = 0;
  const section = document.getElementById('measurement');
  function onScroll() {
    if (section && window.getSectionProgress)
      progress = window.getSectionProgress(section);
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  let raf = 0;
  let t0 = performance.now();

  function draw() {
    const t = (performance.now() - t0) * 0.001;
    ctx.clearRect(0, 0, W, H);

    const p = progress;

    // Three-phase zoom. Compute a single "zoom" value k in [0, 3].
    // k=0: full field. k=1: one CCD fills frame. k=2: one PSF fills frame.
    const k = p * 2.2;
    drawFocalPlane(ctx, W, H, k, t);

    raf = requestAnimationFrame(draw);
  }

  if (fallbackEl) fallbackEl.style.display = 'none';
  draw();

  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('scroll', onScroll);
  }, { once: true });

  /* ──────────────────────────────────────────────────────────
     Main drawing routine — handles all three zoom phases
     ────────────────────────────────────────────────────────── */
  function drawFocalPlane(ctx, W, H, k, t) {
    // Target the lower-right quadrant of the grid so we have somewhere to zoom.
    const focusI = 4, focusJ = 2;

    // The "scale" is exponential in k: 1× at k=0, GRID× at k=1, ~STAMP_N× at k=2.
    const scale = Math.pow(GRID, Math.min(1, k)) *
                  Math.pow(STAMP_N / 4, Math.max(0, k - 1));

    // World-space rectangle covering the full focal plane is [0,1]².
    // We translate so that the focus point of the current zoom stays centred.
    const focusX = (focusI + 0.5) / GRID;
    const focusY = (focusJ + 0.5) / GRID;

    // Within the CCD, focus on a specific star position for phase 3.
    const psfTargetInCell = { x: 0.62, y: 0.38 }; // world coords within the cell
    const worldX = k < 1
      ? 0.5
      : lerp(0.5, focusX + (psfTargetInCell.x - 0.5) / GRID, smoothstep(0.4, 1.0, k));
    const worldY = k < 1
      ? 0.5
      : lerp(0.5, focusY + (psfTargetInCell.y - 0.5) / GRID, smoothstep(0.4, 1.0, k));

    // Viewport fits a unit square at k=0.
    const viewSize = Math.min(W, H) * 0.9;
    const offX = (W - viewSize) / 2;
    const offY = (H - viewSize) / 2;

    // Transform: world (0..1) → screen with pan+scale.
    ctx.save();
    ctx.translate(offX + viewSize / 2, offY + viewSize / 2);
    ctx.scale(viewSize * scale, viewSize * scale);
    ctx.translate(-worldX, -worldY);

    // ─── Layer 1: CCD outlines ───
    drawCcdMosaic(ctx, scale);

    // ─── Layer 2: stars ───
    // Fade stars into PSF stamps once we're zoomed into a single CCD.
    const starAlpha  = 1 - smoothstep(1.0, 1.6, k);
    const stampAlpha = smoothstep(1.0, 1.4, k);

    if (starAlpha > 0.01) drawStars(ctx, scale, starAlpha);
    if (stampAlpha > 0.01) drawPsfStamps(ctx, scale, stampAlpha, focusI, focusJ, k);

    // ─── Layer 3: single-PSF close-up at full zoom ───
    if (k > 1.6) {
      const alpha = smoothstep(1.6, 2.0, k);
      drawSinglePsf(ctx, focusI, focusJ, psfTargetInCell, alpha, t);
    }

    ctx.restore();

    // ─── Phase labels (screen space) ───
    drawPhaseLabels(ctx, W, H, k);
  }

  function drawCcdMosaic(ctx, scale) {
    const gap = 0.006;
    const cell = (1 - gap * (GRID - 1)) / GRID;
    ctx.lineWidth = 1 / (scale * Math.min(W, H) * 0.9);
    ctx.strokeStyle = 'rgba(158, 197, 219, 0.45)';
    ctx.fillStyle = 'rgba(20, 28, 44, 0.55)';

    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const x = i * (cell + gap);
        const y = j * (cell + gap);
        ctx.fillRect(x, y, cell, cell);
        ctx.strokeRect(x, y, cell, cell);
      }
    }
  }

  function drawStars(ctx, scale, alpha) {
    // Star radius in screen pixels, converted to world units.
    const pxToWorld = 1 / (scale * Math.min(W, H) * 0.9);
    for (const s of CCD_STARS) {
      const r = (0.6 + s.mag * 1.8) * pxToWorld;
      const a = alpha * (0.3 + s.mag * 0.7);
      ctx.fillStyle = `rgba(255, 243, 205, ${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();

      if (s.mag > 0.7) {
        ctx.fillStyle = `rgba(255, 255, 255, ${a * 0.9})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawPsfStamps(ctx, scale, alpha, focusI, focusJ, k) {
    // Draw a PSF stamp centred on each star, but only within the focused CCD
    // once we're deep enough in the zoom. Limit count for performance.
    const gap = 0.006;
    const cell = (1 - gap * (GRID - 1)) / GRID;

    const ix0 = focusI * (cell + gap);
    const iy0 = focusJ * (cell + gap);
    const ix1 = ix0 + cell;
    const iy1 = iy0 + cell;

    const stamp = stamps[focusJ * GRID + focusI];
    const stampScreenSize = (cell / GRID) * 1.1;

    ctx.save();
    ctx.globalAlpha = alpha;
    for (const s of CCD_STARS) {
      if (s.x < ix0 || s.x > ix1 || s.y < iy0 || s.y > iy1) continue;
      if (s.mag < 0.35) continue; // skip faintest
      const sz = stampScreenSize * (0.6 + s.mag * 0.6);
      drawStampAt(ctx, stamp, s.x, s.y, sz, s.mag);
    }
    ctx.restore();
  }

  function drawStampAt(ctx, stamp, cx, cy, size, brightness) {
    // Blit the pre-rendered stamp canvas at the world position.
    ctx.drawImage(
      stamp.canvas,
      cx - size / 2, cy - size / 2,
      size, size,
    );
  }

  function drawSinglePsf(ctx, focusI, focusJ, target, alpha, t) {
    const gap = 0.006;
    const cell = (1 - gap * (GRID - 1)) / GRID;
    const cx = focusI * (cell + gap) + target.x * cell;
    const cy = focusJ * (cell + gap) + target.y * cell;

    const stamp = stamps[focusJ * GRID + focusI];
    const size = cell * 0.5;

    ctx.save();
    ctx.globalAlpha = alpha;
    // Draw nearest-neighbour so individual pixels are visible.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(stamp.canvas, cx - size / 2, cy - size / 2, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.restore();
  }

  function drawPhaseLabels(ctx, W, H, k) {
    const labels = [
      { text: 'VIS FOCAL PLANE · 6 × 6 CCDs', range: [0.0, 0.9] },
      { text: 'STARS → PSF STAMPS',           range: [0.9, 1.6] },
      { text: 'ONE STAR · ONE MEASUREMENT',   range: [1.6, 2.4] },
    ];
    ctx.font = '600 11px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (const l of labels) {
      let a = 0;
      if (k >= l.range[0] && k <= l.range[1]) {
        const mid = (l.range[0] + l.range[1]) / 2;
        a = 1 - Math.min(1, Math.abs(k - mid) / ((l.range[1] - l.range[0]) / 2));
      }
      if (a < 0.02) continue;
      ctx.fillStyle = `rgba(230, 236, 255, ${0.7 * a})`;
      ctx.fillText(l.text, 16, 16);
      break;
    }
  }
}

/* ════════════════════════════════════════════════════════════════
   Helpers — catalog generation and PSF stamps
   ════════════════════════════════════════════════════════════════ */
function buildStarCatalog(n) {
  // Random positions, magnitude from a power-law luminosity function.
  // mag in [0, 1]: 0 = faintest (barely visible), 1 = brightest.
  const out = [];
  for (let i = 0; i < n; i++) {
    // Power law: many faint, few bright.
    const u = Math.random();
    const mag = Math.pow(u, 2.2); // skew toward faint
    out.push({
      x: Math.random(),
      y: Math.random(),
      mag,
    });
  }
  return out;
}

function buildPsfStamp(N, fieldX, fieldY) {
  // Compute a field-dependent aberrated PSF via FFT, render to offscreen canvas.
  const field = new Float32Array(N * N);
  computePsfField(field, N, {
    defocus:   0.10 + 0.05 * fieldY,
    astigX:    0.25 * fieldX,
    astigY:    0.25 * fieldY,
    comaX:     0.18 * fieldX,
    comaY:     0.18 * fieldY,
    spherical: 0.08,
  });

  // Log-stretch + inferno, into a small canvas.
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(N, N);

  const logScale = 400;
  const gamma = 0.55;
  for (let i = 0; i < N * N; i++) {
    const v = field[i];
    const stretched = Math.log(1 + v * logScale) / Math.log(1 + logScale);
    const shaped = Math.pow(Math.max(0, Math.min(1, stretched)), gamma);
    const [r, g, b] = infernoColor(shaped);
    img.data[i * 4]     = r * 255;
    img.data[i * 4 + 1] = g * 255;
    img.data[i * 4 + 2] = b * 255;
    img.data[i * 4 + 3] = 255 * Math.min(1, shaped * 4); // alpha fade for dark
  }
  ctx.putImageData(img, 0, 0);
  return { canvas };
}

function computePsfField(out, N, zernikes) {
  const re = new Float32Array(N * N);
  const im = new Float32Array(N * N);
  const cx = N / 2, cy = N / 2;
  const R = N * 0.22, obs = 0.30;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x - cx) / R, dy = (y - cy) / R;
      const rho = Math.sqrt(dx * dx + dy * dy);
      if (rho <= 1 && rho >= obs) {
        const theta = Math.atan2(dy, dx);
        const phi = zernikeWavefront(rho, theta, zernikes);
        re[y * N + x] = Math.cos(phi);
        im[y * N + x] = Math.sin(phi);
      }
    }
  }
  fft2D(re, im, N);

  let maxV = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const sx = (x + N / 2) % N;
      const sy = (y + N / 2) % N;
      const k = sy * N + sx;
      const v = re[k] * re[k] + im[k] * im[k];
      out[y * N + x] = v;
      if (v > maxV) maxV = v;
    }
  }
  const inv = maxV > 0 ? 1 / maxV : 1;
  for (let i = 0; i < out.length; i++) out[i] *= inv;

  // Add a touch of Poisson-ish noise so stamps look like measurements.
  for (let i = 0; i < out.length; i++) {
    out[i] += (Math.random() - 0.5) * 0.008;
    if (out[i] < 0) out[i] = 0;
  }
}

function zernikeWavefront(rho, theta, z) {
  let phi = 0;
  const r2 = rho * rho;
  const r3 = r2 * rho;
  const r4 = r2 * r2;
  if (z.defocus)   phi += z.defocus   * Math.sqrt(3) * (2 * r2 - 1);
  if (z.astigX)    phi += z.astigX    * Math.sqrt(6) * r2 * Math.cos(2 * theta);
  if (z.astigY)    phi += z.astigY    * Math.sqrt(6) * r2 * Math.sin(2 * theta);
  if (z.comaX)     phi += z.comaX     * Math.sqrt(8) * (3 * r3 - 2 * rho) * Math.cos(theta);
  if (z.comaY)     phi += z.comaY     * Math.sqrt(8) * (3 * r3 - 2 * rho) * Math.sin(theta);
  if (z.spherical) phi += z.spherical * Math.sqrt(5) * (6 * r4 - 6 * r2 + 1);
  return phi;
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
        re[b] = re[a] - xr;  im[b] = im[a] - xi;
        re[a] = re[a] + xr;  im[a] = im[a] + xi;
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

function infernoColor(t) {
  t = Math.max(0, Math.min(1, t));
  const r = 0.0002189 + t * (0.1065 + t * (11.60 + t * (-41.70 + t * (77.16 + t * (-71.32 + t * 25.13)))));
  const g = 0.001651 + t * (0.5639 + t * (-3.972 + t * (17.43 + t * (-33.40 + t * (32.62 + t * -12.24)))));
  const b = -0.01986 + t * (3.933 + t * (-15.94 + t * (44.35 + t * (-81.80 + t * (73.21 + t * -23.07)))));
  return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
}

function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}