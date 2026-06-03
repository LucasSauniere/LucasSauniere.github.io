// psf.js — Acts 3 & 4: diffraction simulation (FFT of aberrated pupil field).
// Self-initialises on import; loaded lazily by animations.js.

import * as THREE from 'three';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const photonEl  = document.getElementById('photon-scene');
const problemEl = document.getElementById('problem-scene');

if (photonEl  && webGLAvailable()) safeInit(() => initAct3(photonEl));
if (problemEl && webGLAvailable()) safeInit(() => initAct4(problemEl));

/* ════════════════════════════════════════════════════════════════
   Act 3 — Propagation diagram: star → pupil → PSF
   ════════════════════════════════════════════════════════════════ */
function initAct3(container) {
  const { renderer, scene, camera, stop, onResize, hideLoader } =
    makeSceneBase(container);

  // Three panels aligned along +x, camera faces -z.
  const panelSize = 1.6;
  const spacing   = 2.3;

  // ─── Panel 1: the star (point source represented by a soft glow) ───
  const starGroup = new THREE.Group();
  starGroup.position.x = -spacing;
  scene.add(starGroup);

  const starCore = new THREE.Mesh(
    new THREE.CircleGeometry(0.08, 48),
    new THREE.MeshBasicMaterial({ color: 0xfff3c8 }),
  );
  starGroup.add(starCore);

  const starHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(panelSize, panelSize),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: vsBasic(),
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vUv;
        uniform float uTime;
        void main() {
          vec2 p = vUv - 0.5;
          float r = length(p);
          float g = exp(-r * 12.0) * 0.6;
          float rays = 0.0;
          for (int i = 0; i < 4; i++) {
            float a = float(i) * 0.7853981; // 45°
            vec2 d = vec2(cos(a), sin(a));
            float u = abs(dot(p, d));
            float v = abs(dot(p, vec2(-d.y, d.x)));
            rays += exp(-v * 140.0) * exp(-u * 5.0);
          }
          float flick = 0.9 + 0.1 * sin(uTime * 1.7);
          vec3 col = vec3(1.0, 0.94, 0.78) * (g + rays * 0.35) * flick;
          gl_FragColor = vec4(col, g + rays * 0.3);
        }
      `,
    }),
  );
  starGroup.add(starHalo);

  // ─── Panel 2: the pupil with wavefront phase ───
  const pupilGroup = new THREE.Group();
  pupilGroup.position.x = 0;
  scene.add(pupilGroup);

  const pupilMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uAberration: { value: 0.6 },  // small phase tilt for Act 3 illustration
      uTime:       { value: 0 },
    },
    vertexShader: vsBasic(),
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform float uAberration;
      uniform float uTime;

      vec3 phaseColormap(float t) {
        // blue → black → amber (signed phase)
        vec3 neg = vec3(0.30, 0.55, 0.85);
        vec3 pos = vec3(0.95, 0.70, 0.30);
        if (t < 0.0) return mix(vec3(0.0), neg, -t);
        return mix(vec3(0.0), pos, t);
      }

      void main() {
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;
        float theta = atan(p.y, p.x);

        // Pupil: clear circle with 0.3 central obscuration (Euclid-ish).
        float outer = smoothstep(1.0, 0.98, r);
        float inner = smoothstep(0.28, 0.30, r);
        float pupil = outer * inner;

        // Simple aberration: defocus + astigmatism for the illustration.
        float defocus = (2.0 * r * r - 1.0);
        float astig   = r * r * cos(2.0 * theta);
        float phase   = uAberration * (0.6 * defocus + 0.9 * astig);

        // Normalise to [-1,1] for colour.
        float t = clamp(phase / 1.8, -1.0, 1.0);
        vec3 col = phaseColormap(t);

        // Rim so the aperture boundary reads clearly.
        float rim = smoothstep(0.99, 0.97, r) * smoothstep(0.96, 0.98, r);
        col += vec3(0.8, 0.88, 1.0) * rim * 0.5;

        gl_FragColor = vec4(col * pupil, pupil);
      }
    `,
  });

  const pupilMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(panelSize * 0.85, panelSize * 0.85),
    pupilMat,
  );
  pupilGroup.add(pupilMesh);

  // ─── Panel 3: the PSF ───
  const psfGroup = new THREE.Group();
  psfGroup.position.x = spacing;
  scene.add(psfGroup);

  const N = 128;
  const psfField = new Float32Array(N * N);
  const psfTex = new THREE.DataTexture(psfField, N, N, THREE.RedFormat, THREE.FloatType);
  psfTex.magFilter = THREE.LinearFilter;
  psfTex.minFilter = THREE.LinearFilter;
  psfTex.needsUpdate = true;

  const psfMat = makePsfMaterial(psfTex);
  const psfMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(panelSize, panelSize),
    psfMat,
  );
  psfGroup.add(psfMesh);

  // Compute Act 3's PSF once (mild aberration, mostly Airy).
  computePSFInto(psfField, N, {
    defocus: 0.15,
    astigX:  0.20,
  });
  psfTex.needsUpdate = true;

  // ─── Connecting beams (light flow lines) ───
  const beamsGroup = new THREE.Group();
  scene.add(beamsGroup);
  const beamMat = new THREE.LineBasicMaterial({
    color: 0xfff0c8, transparent: true, opacity: 0.25,
  });
  for (let i = 0; i < 5; i++) {
    const y = (i - 2) * 0.12;
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-spacing + 0.1, y * 0.3, 0),
      new THREE.Vector3(-panelSize * 0.4, y, 0),
      new THREE.Vector3( panelSize * 0.4, y, 0),
      new THREE.Vector3( spacing - 0.1,   y * 0.3, 0),
    ]);
    beamsGroup.add(new THREE.Line(g, beamMat));
  }

  // ─── Panel labels ───
  const labels = [
    { text: 'STAR',            x: -spacing,  y: -panelSize * 0.65 },
    { text: 'PUPIL · PHASE',   x: 0,         y: -panelSize * 0.65 },
    { text: 'PSF',             x:  spacing,  y: -panelSize * 0.65 },
  ];
  labels.forEach(l => {
    const sprite = makeLabel(l.text);
    sprite.position.set(l.x, l.y, 0.01);
    scene.add(sprite);
  });

  // ─── Scroll progress ───
  let progress = 0;
  const sectionPhoton = document.getElementById('photon');
  function onScrollPhoton() {
    if (sectionPhoton && window.getSectionProgress)
      progress = window.getSectionProgress(sectionPhoton);
  }
  window.addEventListener('scroll', onScrollPhoton, { passive: true });

  // ─── Render loop ───
  const clock = new THREE.Clock();
  let raf = 0;

  function render() {
    const t = clock.getElapsedTime();
    const p = progress;
    const pe = easeInOut(p);

    starHalo.material.uniforms.uTime.value = t;
    pupilMat.uniforms.uTime.value = t;

    // Camera dolly: start close on star, pull back to reveal all three panels.
    const cx = -spacing + pe * spacing;
    const cz = 3.2 + (1 - pe) * 1.4;
    camera.position.set(cx * 0.35, reduceMotion ? 0 : Math.sin(t * 0.3) * 0.02, cz);
    camera.lookAt(cx * 0.55, 0, 0);

    // Stagger the panels' reveal with progress.
    starGroup.scale.setScalar(fadeIn(p, 0.00, 0.15));
    pupilGroup.scale.setScalar(fadeIn(p, 0.25, 0.45));
    psfGroup.scale.setScalar(fadeIn(p, 0.55, 0.80));

    // Beams fade in once the pupil is visible.
    beamsGroup.children.forEach(c => {
      c.material.opacity = 0.25 * fadeIn(p, 0.35, 0.7);
    });

    renderer.render(scene, camera);
    raf = requestAnimationFrame(render);
  }

  hideLoader();
  render();

  // Housekeeping.
  onResize();
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(raf);
    stop();
    window.removeEventListener('scroll', onScrollPhoton);
  }, { once: true });
}

/* ════════════════════════════════════════════════════════════════
   Act 4 — Ideal vs as-built comparison
   ════════════════════════════════════════════════════════════════ */
function initAct4(container) {
  const { renderer, scene, camera, stop, onResize, hideLoader } =
    makeSceneBase(container);

  camera.position.set(0, 0, 3.0);

  const N = 128;
  const idealField = new Float32Array(N * N);
  const aberrField = new Float32Array(N * N);

  // Ideal PSF is computed once (all Zernikes zero).
  computePSFInto(idealField, N, {});
  // Aberrated starts as a copy; is recomputed on scroll.
  aberrField.set(idealField);

  const idealTex = new THREE.DataTexture(idealField, N, N, THREE.RedFormat, THREE.FloatType);
  idealTex.magFilter = THREE.LinearFilter;
  idealTex.minFilter = THREE.LinearFilter;
  idealTex.needsUpdate = true;

  const aberrTex = new THREE.DataTexture(aberrField, N, N, THREE.RedFormat, THREE.FloatType);
  aberrTex.magFilter = THREE.LinearFilter;
  aberrTex.minFilter = THREE.LinearFilter;
  aberrTex.needsUpdate = true;

  // Two side-by-side panels.
  const panelSize = 1.6;
  const gap = 0.15;

  const idealMat = makePsfMaterial(idealTex);
  const idealMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(panelSize, panelSize),
    idealMat,
  );
  idealMesh.position.x = -(panelSize / 2 + gap / 2);
  scene.add(idealMesh);

  const aberrMat = makePsfMaterial(aberrTex);
  const aberrMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(panelSize, panelSize),
    aberrMat,
  );
  aberrMesh.position.x = (panelSize / 2 + gap / 2);
  scene.add(aberrMesh);

  // Labels.
  const lIdeal = makeLabel('DIFFRACTION-LIMITED');
  lIdeal.position.set(-(panelSize / 2 + gap / 2), panelSize * 0.58, 0);
  scene.add(lIdeal);

  const lAberr = makeLabel('AS BUILT');
  lAberr.position.set((panelSize / 2 + gap / 2), panelSize * 0.58, 0);
  scene.add(lAberr);

  // HUD element (DOM, not WebGL — easier to style).
  const hud = document.createElement('div');
  hud.className = 'scene-hud';
  hud.innerHTML = `RMS WAVEFRONT ERROR: <span class="hud-num" id="psf-rms">0</span> nm`;
  container.appendChild(hud);
  const rmsNum = hud.querySelector('#psf-rms');

  // ─── Scroll-driven aberration ramp ───
  let progress = 0;
  let lastRecomputeAt = -1;
  const sectionProblem = document.getElementById('problem');
  function onScrollProblem() {
    if (sectionProblem && window.getSectionProgress)
      progress = window.getSectionProgress(sectionProblem);
  }
  window.addEventListener('scroll', onScrollProblem, { passive: true });

  // Recompute the aberrated PSF only when the scroll progress has shifted
  // enough to matter — FFT is O(N² log N), not free.
  function maybeRecompute() {
    const quant = Math.round(progress * 20) / 20; // 5% steps
    if (Math.abs(quant - lastRecomputeAt) < 1e-4) return;
    lastRecomputeAt = quant;

    // Ramp coefficients in radians of wavefront phase.
    const k = quant; // 0..10
    const zernikes = {
      defocus:   0.35 * k,
      astigX:    0.55 * k,
      astigY:    0.20 * k * 2,
      comaX:     0.40 * k * k * 3,
      comaY:     0.15 * k * k * 2,
      spherical: 0.25 * k * k,
      trefoilX:  0.20 * k * k * k,
    };

    computePSFInto(aberrField, N, zernikes);
    aberrTex.needsUpdate = true;

    // Convert phase-RMS in radians → nm of WFE at Euclid's VIS pivot (~725 nm).
    const phaseRms = rmsFromZernikes(zernikes);
    const nm = phaseRms / (2 * Math.PI) * 725;
    rmsNum.textContent = nm.toFixed(0);
  }

  // ─── Render loop ───
  const clock = new THREE.Clock();
  let raf = 0;

  function render() {
    const t = clock.getElapsedTime();
    maybeRecompute();

    // Very gentle breathing; disabled for reduced-motion.
    const bob = reduceMotion ? 0 : Math.sin(t * 0.6) * 0.01;
    idealMesh.position.y = bob;
    aberrMesh.position.y = -bob;

    renderer.render(scene, camera);
    raf = requestAnimationFrame(render);
  }

  hideLoader();
  render();
  onResize();

  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(raf);
    stop();
    window.removeEventListener('scroll', onScrollProblem);
    hud.remove();
  }, { once: true });
}

/* ════════════════════════════════════════════════════════════════
   Scene base — shared renderer/camera setup
   ════════════════════════════════════════════════════════════════ */
function makeSceneBase(container) {
  const fallbackEl = container.querySelector('.scene-fallback');
  let width  = container.clientWidth  || 600;
  let height = container.clientHeight || 340;

  const renderer = new THREE.WebGLRenderer({
    antialias: true, alpha: true, powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 50);
  camera.position.set(0, 0, 3.4);

  scene.add(new THREE.AmbientLight(0xffffff, 1.0));

  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    width = w; height = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });
  ro.observe(container);

  let running = true;
  const io = new IntersectionObserver(entries => {
    for (const e of entries) running = e.isIntersecting;
  }, { rootMargin: '200px' });
  io.observe(container);

  return {
    renderer, scene, camera,
    stop: () => { running = false; ro.disconnect(); io.disconnect(); renderer.dispose(); },
    onResize: () => ro.observe(container),
    hideLoader: () => { if (fallbackEl) fallbackEl.style.display = 'none'; },
  };
}

/* ════════════════════════════════════════════════════════════════
   PSF material — log stretch + inferno-ish colormap
   ════════════════════════════════════════════════════════════════ */
function makePsfMaterial(texture) {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uPsf:       { value: texture },
      uLogScale:  { value: 600.0 },
      uGamma:     { value: 0.55 },
    },
    vertexShader: vsBasic(),
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uPsf;
      uniform float uLogScale;
      uniform float uGamma;

      // Polynomial fit to Matplotlib's "inferno" colormap.
      vec3 inferno(float t) {
        t = clamp(t, 0.0, 1.0);
        const vec3 c0 = vec3(0.0002189, 0.001651, -0.01986);
        const vec3 c1 = vec3(0.1065,    0.5639,    3.933);
        const vec3 c2 = vec3(11.60,    -3.972,   -15.94);
        const vec3 c3 = vec3(-41.70,   17.43,     44.35);
        const vec3 c4 = vec3(77.16,   -33.40,    -81.80);
        const vec3 c5 = vec3(-71.32,   32.62,     73.21);
        const vec3 c6 = vec3(25.13,   -12.24,    -23.07);
        return c0 + t*(c1 + t*(c2 + t*(c3 + t*(c4 + t*(c5 + t*c6)))));
      }

      void main() {
        float v = texture2D(uPsf, vUv).r;
        // Log stretch so the outer Airy rings become visible.
        float stretched = log(1.0 + v * uLogScale) / log(1.0 + uLogScale);
        float shaped = pow(stretched, uGamma);
        vec3 col = inferno(shaped);

        // Soft vignette so the panel edges fade rather than hard-cut.
        vec2 p = vUv - 0.5;
        float vg = smoothstep(0.72, 0.35, length(p));
        gl_FragColor = vec4(col, vg);
      }
    `,
  });
}

/* ════════════════════════════════════════════════════════════════
   PSF computation — FFT of aberrated pupil field
   ════════════════════════════════════════════════════════════════ */
function computePSFInto(out, N, zernikes) {
  const re = new Float32Array(N * N);
  const im = new Float32Array(N * N);

  const cx = N / 2, cy = N / 2;
  const R = N * 0.22;       // pupil radius in pixels
  const obs = 0.30;         // central obscuration fraction

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x - cx) / R;
      const dy = (y - cy) / R;
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

  // |F|² with fftshift and normalisation.
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
  const invMax = maxV > 0 ? 1 / maxV : 1;
  for (let i = 0; i < out.length; i++) out[i] *= invMax;
}

/* Noll-ordered Zernike polynomials, low orders only. */
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
  if (z.trefoilX)  phi += z.trefoilX  * Math.sqrt(8) * r3 * Math.cos(3 * theta);
  if (z.trefoilY)  phi += z.trefoilY  * Math.sqrt(8) * r3 * Math.sin(3 * theta);
  return phi;
}

function rmsFromZernikes(z) {
  // Orthonormal Zernikes → RMS is the Euclidean norm of the coefficients.
  let s = 0;
  for (const k in z) s += z[k] * z[k];
  return Math.sqrt(s);
}

/* ─── In-place radix-2 Cooley–Tukey FFT ─── */
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

/* ════════════════════════════════════════════════════════════════
   Small helpers
   ════════════════════════════════════════════════════════════════ */
function vsBasic() {
  return /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
}

function makeLabel(text) {
  const canvas = document.createElement('canvas');
  const W = 512, H = 96;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(230, 236, 255, 0.72)';
  ctx.font = '600 32px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '6px';
  ctx.fillText(text, W / 2, H / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;

  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.1, 0.21, 1);
  return sprite;
}

function easeInOut(x) { return x * x * (3 - 2 * x); }

function fadeIn(p, a, b) {
  // Smooth ramp from 0 at p=a to 1 at p=b.
  const t = Math.min(1, Math.max(0, (p - a) / Math.max(1e-4, b - a)));
  return t * t * (3 - 2 * t);
}

function webGLAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (_) { return false; }
}

function safeInit(fn) {
  try { fn(); } catch (err) { console.error('[psf] init failed:', err); }
}