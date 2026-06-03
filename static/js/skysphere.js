// skysphere.js — Act 2: the Euclid survey footprint accumulating over the
// Milky Way, reflected in a mirror sphere. Ported from the standalone
// sphere_universe_tiled_v3.html into a container-scoped, scroll-driven module
// loaded lazily by animations.js when #skysphere enters the viewport.
//
// Differences from the standalone viewer:
//   • scoped to #skysphere-scene instead of the whole window/body;
//   • year progression is driven by window.getSectionProgress() (page scroll)
//     instead of wheel/arrow stepping;
//   • Mirror/Globe/Hover/Invert UI buttons removed (mirror surface only);
//   • drag-to-look (OrbitControls) and idle auto-spin retained;
//   • graceful fallback if the footprint manifest / Milky Way TIFF are absent.
//
// Data (user-provided): static/euclid/frames_tiled/manifest.json + tiles and
// static/euclid/spherex1.tif. UTIF (window.UTIF) decodes the TIFF; it is loaded
// via a <script> tag in phd.html.j2.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ========== Config ========== */
const TILES_DIR    = 'static/euclid/frames_tiled';
const MILKYWAY_TIF = 'static/euclid/spherex1.tif';

const KEYFRAMES_PER_YEAR = 2;    // crossfade keyframes sampled per year
const EDGE_OPACITY = 1;
const EDGE_BOOST   = 2;
const TARGET_SPIN  = 0.15;       // idle auto-spin rad/s
const IDLE_DELAY   = 1500;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const container = document.getElementById('skysphere-scene');
const section   = document.getElementById('skysphere');

if (container && webGLAvailable()) {
  if (!window.UTIF) {
    console.warn('[skysphere] UTIF not loaded; cannot decode Milky Way TIFF.');
    showFallback(container, 'Survey viewer unavailable.');
  } else {
    try { initScene(container, section); }
    catch (err) {
      console.error('[skysphere] init failed:', err);
      showFallback(container, 'Survey viewer unavailable.');
    }
  }
} else if (container) {
  showFallback(container, 'WebGL not available.');
}

/* ════════════════════════════════════════════════════════════════ */
function initScene(container, section) {
  const fallbackEl = container.querySelector('.scene-fallback');
  const yearLabelEl = container.querySelector('.skysphere-year');
  const UTIF = window.UTIF;

  let width  = container.clientWidth  || 640;
  let height = container.clientHeight || 360;

  /* ── Scene / renderer ── */
  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 0, 4.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const maxTextureSize = renderer.capabilities.maxTextureSize;

  const sphereGeo = new THREE.SphereGeometry(1.0, 256, 256);
  const sphereMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 1.0, roughness: 0.05, envMapIntensity: 1.0,
  });
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  scene.add(sphere);
  scene.add(new THREE.AmbientLight(0x404060, 0.5));

  /* ── State ── */
  let milkyWayCanvas = null, composite = null, compositeCtx = null;
  let universeTex = null, cubeRT = null;
  let manifest = null;
  const tileCache = new Map(), tileInFlight = new Map();
  let edgeA, edgeCtxA, edgeB, edgeCtxB, edgeScratch, edgeScratchCtx;
  let yearGroups = [];
  let currentYear = 0, yearAnimT = 0;
  let kfA = -1, kfB = -1, loadingA = -1, loadingB = -1;
  let blendT = 0, compositeDirty = true;
  const surfaceMode = 'mirror';

  /* ── TIFF loader ── */
  async function loadTIFF(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
    const buf = await r.arrayBuffer();
    const ifds = UTIF.decode(buf);
    if (!ifds.length) throw new Error('No images in TIFF');
    UTIF.decodeImage(buf, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const w = ifds[0].width, h = ifds[0].height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const img = c.getContext('2d').createImageData(w, h);
    img.data.set(rgba);
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  }

  /* ── Mollweide → Equirectangular ── */
  function mollweideToEquirectangular(srcCanvas, outW, outH) {
    const srcW = srcCanvas.width, srcH = srcCanvas.height;
    const src = srcCanvas.getContext('2d').getImageData(0, 0, srcW, srcH).data;
    const out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    const outCtx = out.getContext('2d');
    const dst = outCtx.createImageData(outW, outH);
    const d = dst.data;
    const INV_PI = 1 / Math.PI;
    function solveTheta(phi) {
      if (Math.abs(phi) > Math.PI / 2 - 1e-6) return Math.sign(phi) * Math.PI / 2;
      const target = Math.PI * Math.sin(phi);
      let theta = phi;
      for (let i = 0; i < 8; i++) {
        const f = 2 * theta + Math.sin(2 * theta) - target;
        const fp = 2 + 2 * Math.cos(2 * theta);
        const dlt = f / fp; theta -= dlt;
        if (Math.abs(dlt) < 1e-9) break;
      }
      return theta;
    }
    const sample = (sx, sy) => {
      if (sx < 0 || sx >= srcW || sy < 0 || sy >= srcH) return [0, 0, 0, 255];
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, srcW - 1), y1 = Math.min(y0 + 1, srcH - 1);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * srcW + x0) * 4, i10 = (y0 * srcW + x1) * 4,
            i01 = (y1 * srcW + x0) * 4, i11 = (y1 * srcW + x1) * 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      return [
        src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11,
        src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11,
        src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11,
        src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11,
      ];
    };
    for (let y = 0; y < outH; y++) {
      const phi = (0.5 - (y + 0.5) / outH) * Math.PI;
      const theta = solveTheta(phi);
      const cT = Math.cos(theta), sT = Math.sin(theta);
      const sy = (1 - sT) * 0.5 * srcH;
      for (let x = 0; x < outW; x++) {
        const lambda = ((x + 0.5) / outW - 0.5) * 2 * Math.PI;
        const xN = lambda * cT * INV_PI;
        const sx = (xN + 1) * 0.5 * srcW;
        const o = (y * outW + x) * 4;
        if (xN < -1 || xN > 1) { d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 255; continue; }
        const [r, g, b, a] = sample(sx, sy);
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
      }
    }
    outCtx.putImageData(dst, 0, 0);
    return out;
  }

  /* ── Tile loading (lazy + cached) ── */
  function loadTile(fname) {
    if (tileCache.has(fname))    return Promise.resolve(tileCache.get(fname));
    if (tileInFlight.has(fname)) return tileInFlight.get(fname);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => { tileCache.set(fname, img); tileInFlight.delete(fname); resolve(img); };
      img.onerror = () => { tileInFlight.delete(fname); reject(new Error(`tile ${fname} failed`)); };
      img.src = `${TILES_DIR}/${fname}`;
    });
    tileInFlight.set(fname, p);
    return p;
  }

  async function ensureFrameLoaded(frameIdx) {
    const recs = manifest.frames[frameIdx];
    if (!recs) return;
    await Promise.all(recs.map(r => loadTile(r.f).catch(() => null)));
  }

  function whiteSilhouette(img) {
    const ts = manifest.tile;
    edgeScratchCtx.globalCompositeOperation = 'source-over';
    edgeScratchCtx.clearRect(0, 0, ts, ts);
    for (let p = 0; p < EDGE_BOOST; p++) edgeScratchCtx.drawImage(img, 0, 0);
    edgeScratchCtx.globalCompositeOperation = 'source-in';
    edgeScratchCtx.fillStyle = '#fff';
    edgeScratchCtx.fillRect(0, 0, ts, ts);
    edgeScratchCtx.globalCompositeOperation = 'source-over';
    return edgeScratch;
  }

  function rebuildEdgeOn(ctx, canvas, frameIdx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const recs = manifest.frames[frameIdx];
    if (!recs) return;
    const ts = manifest.tile;
    for (const r of recs) {
      const img = tileCache.get(r.f);
      if (!img) continue;
      const sil = whiteSilhouette(img);
      ctx.drawImage(sil, r.x * ts, r.y * ts);
    }
  }

  /* ── Year grouping ── */
  function extractYear(dateStr) {
    if (!dateStr) return null;
    const m = String(dateStr).match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : null;
  }

  function setupYearGroups() {
    yearGroups = [];
    const N = manifest.n_frames;
    if (N === 0) return;
    const dates = manifest.dates || [];
    const yearByFrame = [];
    let allHaveYear = true;
    for (let i = 0; i < N; i++) {
      const y = extractYear(dates[i]);
      if (y == null) { allHaveYear = false; break; }
      yearByFrame.push(y);
    }
    const buckets = new Map();
    if (allHaveYear) {
      for (let i = 0; i < N; i++) {
        const y = yearByFrame[i];
        if (!buckets.has(y)) buckets.set(y, []);
        buckets.get(y).push(i);
      }
      const sortedYears = Array.from(buckets.keys()).sort((a, b) => a - b);
      sortedYears.forEach((y, idx) => {
        yearGroups.push({ label: `Year ${idx + 1}`, calendarYear: y, frameIndices: buckets.get(y) });
      });
    } else {
      const N_YEARS = 6;
      const per = Math.ceil(N / N_YEARS);
      for (let y = 0; y < N_YEARS; y++) {
        const frames = [];
        for (let i = y * per; i < Math.min((y + 1) * per, N); i++) frames.push(i);
        if (frames.length) yearGroups.push({ label: `Year ${y + 1}`, calendarYear: null, frameIndices: frames });
      }
    }
    for (const g of yearGroups) {
      const fr = g.frameIndices;
      const stops = Math.min(KEYFRAMES_PER_YEAR, fr.length);
      const kfs = [];
      if (stops <= 1) kfs.push(fr[0]);
      else for (let i = 0; i < stops; i++) kfs.push(fr[Math.round(i * (fr.length - 1) / (stops - 1))]);
      g.keyframes = kfs;
    }
  }

  function flashYearLabel() {
    if (!yearLabelEl) return;
    const g = yearGroups[currentYear];
    if (!g) return;
    yearLabelEl.textContent = g.label;
    yearLabelEl.classList.remove('flash');
    void yearLabelEl.offsetWidth;        // restart the CSS animation
    yearLabelEl.classList.add('flash');
  }

  /* ── Edge slot loading ── */
  async function requestEdgeSlot(slot, frameIdx) {
    if (slot === 'A') {
      if (kfA === frameIdx || loadingA === frameIdx) return;
      loadingA = frameIdx;
      await ensureFrameLoaded(frameIdx);
      if (loadingA !== frameIdx) return;
      rebuildEdgeOn(edgeCtxA, edgeA, frameIdx);
      kfA = frameIdx; loadingA = -1;
    } else {
      if (kfB === frameIdx || loadingB === frameIdx) return;
      loadingB = frameIdx;
      await ensureFrameLoaded(frameIdx);
      if (loadingB !== frameIdx) return;
      rebuildEdgeOn(edgeCtxB, edgeB, frameIdx);
      kfB = frameIdx; loadingB = -1;
    }
    compositeDirty = true;
  }

  function updateComposite() {
    if (!composite || !milkyWayCanvas) return;
    compositeCtx.clearRect(0, 0, composite.width, composite.height);
    compositeCtx.drawImage(milkyWayCanvas, 0, 0, composite.width, composite.height);

    if (edgeA && edgeB && kfA >= 0 && kfB >= 0) {
      if (kfA === kfB) {
        compositeCtx.globalAlpha = EDGE_OPACITY;
        compositeCtx.drawImage(edgeA, 0, 0, composite.width, composite.height);
      } else {
        compositeCtx.globalAlpha = (1 - blendT) * EDGE_OPACITY;
        compositeCtx.drawImage(edgeA, 0, 0, composite.width, composite.height);
        compositeCtx.globalAlpha = blendT * EDGE_OPACITY;
        compositeCtx.drawImage(edgeB, 0, 0, composite.width, composite.height);
      }
      compositeCtx.globalAlpha = 1;
    } else if (edgeA && kfA >= 0) {
      compositeCtx.globalAlpha = EDGE_OPACITY;
      compositeCtx.drawImage(edgeA, 0, 0, composite.width, composite.height);
      compositeCtx.globalAlpha = 1;
    }

    if (universeTex) universeTex.needsUpdate = true;
    if (cubeRT && universeTex && surfaceMode === 'mirror')
      cubeRT.fromEquirectangularTexture(renderer, universeTex);
  }

  /* ── Scroll → year position ── */
  function updateFromScroll() {
    if (!manifest || yearGroups.length === 0) return;
    const p = (section && window.getSectionProgress) ? window.getSectionProgress(section) : 0;
    const len = yearGroups.length;
    const gpos = Math.min(len - 1e-4, p * len);   // global float position across years
    const newYear = Math.max(0, Math.min(len - 1, Math.floor(gpos)));
    const newAnimT = Math.max(0, Math.min(1, gpos - newYear));

    if (newYear !== currentYear) {
      currentYear = newYear;
      flashYearLabel();
    }
    if (newAnimT !== yearAnimT) {
      yearAnimT = newAnimT;
      compositeDirty = true;
    }
  }

  /* ── Keyframe selection for the current (year, animT) ── */
  function selectKeyframes() {
    const g = yearGroups[currentYear];
    if (!g) return;
    const kfs = g.keyframes;
    const stops = kfs.length;
    const pos = yearAnimT * (stops - 1);
    const lo = Math.max(0, Math.min(stops - 1, Math.floor(pos)));
    const hi = Math.max(0, Math.min(stops - 1, lo + 1));
    const a = kfs[lo], b = kfs[hi];
    if (a !== kfA && a !== loadingA) requestEdgeSlot('A', a);
    if (b !== kfB && b !== loadingB) requestEdgeSlot('B', b);
    const newBlend = (lo === hi) ? 0 : (pos - lo);
    if (newBlend !== blendT) { blendT = newBlend; compositeDirty = true; }
  }

  /* ── Background prefetch of every year keyframe ── */
  async function prefetchYearKeyframesBackground() {
    if (!manifest || yearGroups.length === 0) return;
    const all = new Set();
    for (const g of yearGroups)
      for (const idx of g.keyframes) {
        const recs = manifest.frames[idx];
        if (!recs) continue;
        for (const r of recs) all.add(r.f);
      }
    const list = Array.from(all);
    const BATCH = 16;
    for (let i = 0; i < list.length; i += BATCH)
      await Promise.all(list.slice(i, i + BATCH).map(f => loadTile(f).catch(() => null)));
  }

  async function fetchManifest() {
    const r = await fetch(`${TILES_DIR}/manifest.json`);
    if (!r.ok) throw new Error(`manifest HTTP ${r.status}`);
    return r.json();
  }

  /* ── Pipeline ── */
  (async () => {
    let srcCanvas;
    try {
      srcCanvas = await loadTIFF(MILKYWAY_TIF);
    } catch (e) {
      console.warn('[skysphere] no Milky Way TIFF:', e.message);
      showFallback(container, 'Survey data not available yet.');
      return;
    }

    const mf = await fetchManifest().catch((e) => {
      console.warn('[skysphere] no manifest:', e.message); return null;
    });
    manifest = mf;

    const W = Math.min(maxTextureSize, manifest ? manifest.width : 4096);
    const H = W / 2;
    milkyWayCanvas = mollweideToEquirectangular(srcCanvas, W, H);

    composite = document.createElement('canvas');
    composite.width = W; composite.height = H;
    compositeCtx = composite.getContext('2d');

    universeTex = new THREE.CanvasTexture(composite);
    universeTex.mapping = THREE.EquirectangularReflectionMapping;
    universeTex.colorSpace = THREE.SRGBColorSpace;
    universeTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    cubeRT = new THREE.WebGLCubeRenderTarget(2048, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    cubeRT.texture.colorSpace = THREE.SRGBColorSpace;
    sphere.rotation.y = Math.PI / 2;

    scene.background = cubeRT.texture;
    sphereMat.envMap = cubeRT.texture;
    sphereMat.needsUpdate = true;

    if (manifest) {
      edgeA = document.createElement('canvas');
      edgeA.width = manifest.width; edgeA.height = manifest.height;
      edgeCtxA = edgeA.getContext('2d');
      edgeB = document.createElement('canvas');
      edgeB.width = manifest.width; edgeB.height = manifest.height;
      edgeCtxB = edgeB.getContext('2d');
      edgeScratch = document.createElement('canvas');
      edgeScratch.width = edgeScratch.height = manifest.tile;
      edgeScratchCtx = edgeScratch.getContext('2d');

      setupYearGroups();

      // Pre-paint the first year's opening keyframes.
      const first = yearGroups[0];
      const firstA = first.keyframes[0];
      const firstB = first.keyframes[Math.min(1, first.keyframes.length - 1)];
      await ensureFrameLoaded(firstA);
      rebuildEdgeOn(edgeCtxA, edgeA, firstA); kfA = firstA;
      if (firstB !== firstA) { await ensureFrameLoaded(firstB); rebuildEdgeOn(edgeCtxB, edgeB, firstB); }
      kfB = firstB;

      currentYear = 0; yearAnimT = 0; blendT = 0; compositeDirty = true;
      flashYearLabel();
      prefetchYearKeyframesBackground();
    } else {
      // Milky Way only — still a nice mirror sphere, just no footprint.
      compositeDirty = true;
      if (yearLabelEl) yearLabelEl.style.display = 'none';
    }

    if (fallbackEl) fallbackEl.style.display = 'none';
  })();

  /* ── Controls: drag-to-look only (wheel passes through to page scroll) ── */
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.05;
  controls.enableZoom = false; controls.enablePan = false;
  controls.minDistance = 1.5; controls.maxDistance = 10;

  let lastInteract = nowMs();
  const bump = () => { lastInteract = nowMs(); };
  renderer.domElement.addEventListener('pointerdown', bump);
  renderer.domElement.addEventListener('pointermove', bump);

  /* ── Animation loop ── */
  const clock = new THREE.Clock();
  let idleSpin = 0, rafId = 0, running = false;

  function animate() {
    running = true;
    const dt = clock.getDelta();

    updateFromScroll();
    selectKeyframes();

    if (compositeDirty) { updateComposite(); compositeDirty = false; }

    const idle = !reduceMotion && (nowMs() - lastInteract > IDLE_DELAY);
    const target = idle ? TARGET_SPIN : 0;
    idleSpin += (target - idleSpin) * Math.min(1, dt * 3);
    sphere.rotation.y += idleSpin * dt;

    controls.update();
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(animate);
  }
  function stop() { running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
  animate();

  /* ── Resize ── */
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    width = w; height = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });
  ro.observe(container);

  /* ── Pause when off-screen ── */
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !running) animate();
      else if (!e.isIntersecting && running) stop();
    }
  }, { rootMargin: '200px' });
  io.observe(container);

  window.addEventListener('pagehide', () => {
    stop(); ro.disconnect(); io.disconnect();
    controls.dispose(); renderer.dispose();
  }, { once: true });
}

/* ════════════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════════════ */
function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
}

function webGLAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
              (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (_) { return false; }
}

function showFallback(container, msg) {
  const fb = container.querySelector('.scene-fallback');
  if (fb) { fb.textContent = msg; fb.style.display = ''; }
}
