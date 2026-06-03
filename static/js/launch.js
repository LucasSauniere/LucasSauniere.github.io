// launch.js — Act 1: Earth → L2. A textured Earth that the camera pulls
// back from as Euclid drifts out toward Lagrange point 2. Scroll-driven via
// window.getSectionProgress(). Loaded lazily by animations.js when #launch
// enters the viewport.
//
// This is an *equivalent* of the threejs-journey Earth-shaders lesson, built
// from scratch — none of that course's licensed code is used here. The Earth
// uses static/3d/Earth_comp.glb when available, with a procedural shaded
// sphere + atmosphere as fallback.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const container = document.getElementById('launch-scene');
const section   = document.getElementById('launch');

if (container && webGLAvailable()) {
  try { initScene(container, section); }
  catch (err) {
    console.error('[launch] scene init failed:', err);
    showFallbackMessage(container, 'Scene unavailable.');
  }
}
// If WebGL is unavailable we simply leave the 2D starfield (animations.js
// Act 1) visible behind the hero text — no fallback message needed.

/* ════════════════════════════════════════════════════════════════
   Main scene
   ════════════════════════════════════════════════════════════════ */
function initScene(container, section) {
  const fallbackEl = container.querySelector('.scene-fallback');

  let width  = container.clientWidth  || window.innerWidth;
  let height = container.clientHeight || window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.01, 100);
  camera.position.set(0, 0, 3.0);

  // ── Lighting: warm sun key + cool ambient/rim ──
  scene.add(new THREE.AmbientLight(0x33405a, 0.55));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  sun.position.set(5, 2.5, 4);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x5e8fc9, 0.7);
  rim.position.set(-4, -1, -3);
  scene.add(rim);

  // ── Earth ──
  const EARTH_RADIUS = 1.0;
  const earthGroup = new THREE.Group();
  scene.add(earthGroup);

  let earth = null;

  // Procedural fallback Earth is created immediately so the frame is never
  // empty; if the GLB loads we swap it out.
  const fallbackEarth = buildProceduralEarth(EARTH_RADIUS);
  earthGroup.add(fallbackEarth);
  earth = fallbackEarth;

  new GLTFLoader().load(
    'static/3d/Earth_comp.glb',
    (gltf) => {
      const model = gltf.scene;
      normalizeModel(model, EARTH_RADIUS * 2);
      earthGroup.remove(fallbackEarth);
      disposeObject(fallbackEarth);
      earthGroup.add(model);
      earth = model;
      if (fallbackEl) fallbackEl.style.display = 'none';
    },
    undefined,
    () => {
      console.info('[launch] no Earth GLB; using procedural Earth.');
      if (fallbackEl) fallbackEl.style.display = 'none';
    },
  );

  // ── Atmosphere halo (backside additive shell) ──
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.18, 64, 48),
    makeAtmosphereMaterial(),
  );
  earthGroup.add(atmosphere);

  // ── Starfield backdrop ──
  const stars = makeStarField(900, 30);
  scene.add(stars);

  // ── Euclid spacecraft (GLB → procedural fallback) ──
  let euclid = null;
  const euclidPivot = new THREE.Group();
  scene.add(euclidPivot);

  new GLTFLoader().load(
    'static/3d/Euclid.glb',
    (gltf) => {
      euclid = gltf.scene;
      normalizeModel(euclid, 0.32);
      euclidPivot.add(euclid);
    },
    undefined,
    () => { console.info('[launch] no Euclid GLB; spacecraft hidden.'); },
  );

  // L2 marker direction (anti-sun, i.e. away from the warm key light).
  const L2_DIR = new THREE.Vector3(-1.0, 0.25, -0.4).normalize();

  requestAnimationFrame(() => { if (fallbackEl) fallbackEl.style.display = 'none'; });

  // ── Scroll-driven progress ──
  let progress = 0;
  function onScroll() {
    if (section && window.getSectionProgress)
      progress = window.getSectionProgress(section);
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // ── Render loop ──
  const clock = new THREE.Clock();
  let rafId = 0, running = false;

  function render() {
    running = true;
    const t  = clock.getElapsedTime();
    const p  = progress;
    const pe = easeInOut(p);

    // Camera dollies back: start hugging the limb, end far enough to see
    // Euclid en route to L2.
    camera.position.set(0, 0.05 + pe * 0.15, 3.0 + pe * 6.5);
    camera.lookAt(0, 0, 0);

    // Earth: slow idle spin (frozen under reduced motion).
    if (earth && !reduceMotion) earth.rotation.y = t * 0.05;
    earthGroup.rotation.z = 0.41; // ~23.5° axial tilt feel

    // Euclid: lifts off the limb and travels out toward L2 as we scroll.
    if (euclid) {
      const start = new THREE.Vector3(0.2, 0.85, 0.6);          // just above the limb
      const end   = L2_DIR.clone().multiplyScalar(7.5);          // far field, L2
      euclidPivot.position.lerpVectors(start, end, pe);
      const wobble = reduceMotion ? 0 : Math.sin(t * 0.8) * 0.04;
      euclidPivot.rotation.set(wobble, t * 0.1 + pe * 1.2, wobble * 0.5);
      euclidPivot.visible = pe > 0.02;
    }

    if (!reduceMotion) stars.rotation.y = t * 0.005;

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(render);
  }
  function stop() { running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
  render();

  // ── Resize ──
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    width = w; height = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });
  ro.observe(container);

  // ── Pause when off-screen ──
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !running) render();
      else if (!e.isIntersecting && running) stop();
    }
  }, { rootMargin: '200px' });
  io.observe(container);

  window.addEventListener('pagehide', () => {
    stop(); ro.disconnect(); io.disconnect();
    window.removeEventListener('scroll', onScroll);
    renderer.dispose();
  }, { once: true });
}

/* ════════════════════════════════════════════════════════════════
   Procedural Earth fallback (used until / unless the GLB loads)
   ════════════════════════════════════════════════════════════════ */
function buildProceduralEarth(radius) {
  const geo = new THREE.SphereGeometry(radius, 96, 64);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3(5, 2.5, 4).normalize() } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec2 vUv;
      void main() {
        vN = normalize(normalMatrix * normal);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vN; varying vec2 vUv;
      uniform vec3 uSun;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
        return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
      }
      void main() {
        // Crude continents from layered noise; blue oceans otherwise.
        float n = noise(vUv*8.0) * 0.6 + noise(vUv*18.0) * 0.3 + noise(vUv*40.0) * 0.1;
        float land = smoothstep(0.55, 0.6, n);
        vec3 ocean = vec3(0.04, 0.18, 0.38);
        vec3 green = vec3(0.16, 0.34, 0.14);
        vec3 base  = mix(ocean, green, land);
        // Day/night terminator from the sun direction.
        float lambert = clamp(dot(normalize(vN), normalize(uSun)), 0.0, 1.0);
        float day = smoothstep(0.0, 0.35, lambert);
        vec3 night = base * 0.06 + vec3(0.02,0.02,0.05);
        vec3 color = mix(night, base, day);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

function makeAtmosphereMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(0x4a90d9) } },
    vertexShader: /* glsl */`
      varying vec3 vN;
      void main() {
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec3 vN;
      uniform vec3 uColor;
      void main() {
        float rim = pow(1.0 - abs(vN.z), 2.6);
        gl_FragColor = vec4(uColor, rim * 0.9);
      }
    `,
  });
}

/* ════════════════════════════════════════════════════════════════
   Starfield
   ════════════════════════════════════════════════════════════════ */
function makeStarField(count, radius) {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random(), v = Math.random();
    const th = 2 * Math.PI * u;
    const ph = Math.acos(2 * v - 1);
    const r  = radius * (0.85 + Math.random() * 0.15);
    positions[3 * i]     = r * Math.sin(ph) * Math.cos(th);
    positions[3 * i + 1] = r * Math.sin(ph) * Math.sin(th);
    positions[3 * i + 2] = r * Math.cos(ph);
  }
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.05, sizeAttenuation: true, color: 0xdce8ff,
    transparent: true, opacity: 0.8, depthWrite: false,
  });
  return new THREE.Points(geom, mat);
}

/* ════════════════════════════════════════════════════════════════
   Helpers (mirrors euclid.js)
   ════════════════════════════════════════════════════════════════ */
function normalizeModel(obj, target) {
  const box  = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = target / maxDim;
  obj.scale.setScalar(scale);
  const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
  obj.position.sub(center);
}

function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

function easeInOut(x) { return x * x * (3 - 2 * x); }

function webGLAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
              (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (_) { return false; }
}

function showFallbackMessage(container, msg) {
  const fb = container.querySelector('.scene-fallback');
  if (fb) fb.textContent = msg;
}
