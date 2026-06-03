// euclid.js — Act 2: Euclid satellite + survey footprint on celestial sphere.
// Loaded lazily by animations.js when #mission enters the viewport.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const container = document.getElementById('euclid-scene');
if (container && webGLAvailable()) {
  try { initScene(container); }
  catch (err) {
    console.error('[euclid] scene init failed:', err);
    showFallbackMessage(container, 'Scene unavailable.');
  }
} else if (container) {
  showFallbackMessage(container, 'WebGL not available.');
}

/* ════════════════════════════════════════════════════════════════
   Main scene
   ════════════════════════════════════════════════════════════════ */
function initScene(container) {
  const fallbackEl = container.querySelector('.scene-fallback');

  // ── Renderer ──
  let width  = container.clientWidth  || 400;
  let height = container.clientHeight || 300;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // ── Scene + camera ──
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
  camera.position.set(0, 0, 6.5);

  // ── Lighting: cold ambient + warm sun key + cool rim ──
  scene.add(new THREE.AmbientLight(0x4a5870, 0.45));

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.0);
  sun.position.set(4, 2, 3);
  scene.add(sun);

  const rim = new THREE.DirectionalLight(0x5e8fc9, 0.8);
  rim.position.set(-3, -1, -2);
  scene.add(rim);

  // ── Celestial sphere with Mollweide footprint ──
  const skyGroup = new THREE.Group();
  scene.add(skyGroup);

  const skyMaterial = makeMollweideMaterial();
  const skyMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 96, 64),
    skyMaterial,
  );
  skyGroup.add(skyMesh);

  // Try to load the Mollweide footprint. If it fails, the shader's
  // fallback branch keeps the sphere visually alive.
  new THREE.TextureLoader().load(
    'static/images/euclid_footprint_bis.png',
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
      skyMaterial.uniforms.uMap.value = tex;
      skyMaterial.uniforms.uHasMap.value = 1.0;
    },
    undefined,
    () => { console.info('[euclid] no footprint texture; using procedural fallback.'); },
  );

  // ── Background starfield ──
  const stars = makeStarField(280, 14);
  scene.add(stars);

  // ── Euclid model (GLB with procedural fallback) ──
  let euclid = null;
  const euclidPivot = new THREE.Group();
  scene.add(euclidPivot);

  new GLTFLoader().load(
    'static/3d/Euclid.glb',
    (gltf) => {
      euclid = gltf.scene;
      normalizeModel(euclid, 1.0);
      euclidPivot.add(euclid);
      if (fallbackEl) fallbackEl.style.display = 'none';
    },
    undefined,
    () => {
      console.info('[euclid] no GLB; using procedural satellite.');
      euclid = buildProceduralEuclid();
      euclidPivot.add(euclid);
      if (fallbackEl) fallbackEl.style.display = 'none';
    },
  );

  // Hide loader as soon as the renderer paints its first frame.
  requestAnimationFrame(() => {
    if (fallbackEl) fallbackEl.style.display = 'none';
  });

  // ── Scroll-driven progress (0..1 as #mission crosses viewport) ──
  let progress = 0;
  const sectionMission = document.getElementById('mission');
  function onScroll() {
    if (sectionMission && window.getSectionProgress)
      progress = window.getSectionProgress(sectionMission);
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // ── Render loop ──
  const clock = new THREE.Clock();
  let rafId = 0;
  let running = false;

  function render() {
    running = true;
    const t = clock.getElapsedTime();
    const p = progress;

    // Ease the raw scroll progress so the middle of the section has the
    // "hero shot" framing, with gentle approach/departure.
    const pe = easeInOut(p);

    // Camera: subtle push-in, slight rise, tiny lateral pan.
    camera.position.set(
      -0.25 + pe * 0.35,
      -0.2  + pe * 0.55,
       6.6  - pe * 1.7,
    );
    camera.lookAt(0.1, 0, 0);

    // Sky sphere: slow idle yaw + scroll-driven tilt.
    const idle = reduceMotion ? 0 : t * 0.04;
    skyGroup.rotation.y = idle;
    skyGroup.rotation.x = -0.12 + pe * 0.26;
    skyMaterial.uniforms.uTime.value = t;

    // Euclid: arc across the frame, left→centre→right, always in front.
    if (euclid) {
      const angle = -Math.PI * 0.65 + pe * Math.PI * 1.3;   // ~ -117° → +117°
      euclidPivot.position.set(
        Math.sin(angle) * 2.25,
        Math.cos(angle) * 0.35 - 0.1,
        1.35 + Math.cos(angle) * 0.45,
      );
      // Gentle roll + bob so it reads as a spacecraft, not a sticker.
      const wobble = reduceMotion ? 0 : Math.sin(t * 0.7) * 0.05;
      euclidPivot.rotation.set(
        wobble * 0.5,
        t * 0.12 + pe * 0.8,
        wobble,
      );
    }

    // Stars: near-imperceptible parallax drift.
    if (!reduceMotion) stars.rotation.y = t * 0.008;

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(render);
  }

  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  render();

  // ── Resize ──
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
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

  // ── Cleanup on unload (belt & braces for SPA-ish navigation) ──
  window.addEventListener('pagehide', () => {
    stop();
    ro.disconnect();
    io.disconnect();
    window.removeEventListener('scroll', onScroll);
    renderer.dispose();
  }, { once: true });
}

/* ════════════════════════════════════════════════════════════════
   Mollweide → sphere shader
   ════════════════════════════════════════════════════════════════ */
function makeMollweideMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap:    { value: null },
      uHasMap: { value: 0.0 },
      uTint:   { value: new THREE.Color(0x9ec5db) },
      uTime:   { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vN  = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;

      varying vec2 vUv;
      varying vec3 vN;

      uniform sampler2D uMap;
      uniform float     uHasMap;
      uniform vec3      uTint;
      uniform float     uTime;

      #define PI    3.14159265359
      #define SQRT2 1.41421356237

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        // Equirectangular lat/lon from sphere UVs.
        float lon = (vUv.x - 0.5) * 2.0 * PI;   // [-π, π]
        float lat = (vUv.y - 0.5) * PI;         // [-π/2, π/2]

        // Newton's method: find θ such that 2θ + sin(2θ) = π·sin(lat).
        float theta = lat;
        for (int i = 0; i < 6; i++) {
          float f  = 2.0 * theta + sin(2.0 * theta) - PI * sin(lat);
          float fp = 2.0 + 2.0 * cos(2.0 * theta);
          theta -= f / max(fp, 1e-4);
        }

        // Mollweide plane coords.
        float mx = (2.0 * SQRT2 / PI) * lon * cos(theta);
        float my = SQRT2 * sin(theta);

        // Normalised to [0,1] UV for the texture.
        vec2 muv = vec2(
          mx / (4.0 * SQRT2) + 0.5,
          my / (2.0 * SQRT2) + 0.5
        );

        // Ellipse mask: (mx/2√2)² + (my/√2)² ≤ 1.
        float ex = mx / (2.0 * SQRT2);
        float ey = my /  SQRT2;
        float inEllipse = step(ex * ex + ey * ey, 1.0);

        // Base "empty sky" colour.
        vec3 base = vec3(0.018, 0.028, 0.060);

        // Sample the footprint and lift it slightly with the accent tint.
        vec4 tex = texture2D(uMap, muv);
        float bright = max(max(tex.r, tex.g), tex.b);
        vec3 footprint = tex.rgb * 1.15 + uTint * bright * 0.25;
        float hasMapMask = uHasMap * inEllipse * smoothstep(0.04, 0.35, bright);

        vec3 color = mix(base, footprint, hasMapMask);

        // Procedural fallback: a soft galactic band + sparse dots so the
        // sphere still reads even without the image.
        float noMap = (1.0 - uHasMap) * inEllipse;
        float band  = exp(-pow(vUv.y - 0.5, 2.0) * 22.0);
        float dots  = step(0.995, hash(floor(vUv * 220.0)));
        color += noMap * (band * 0.18 * uTint + dots * 0.55 * vec3(1.0));

        // Rim glow (atmospheric halo feel).
        float rim = pow(1.0 - abs(vN.z), 3.0);
        color += uTint * rim * 0.20;

        gl_FragColor = vec4(color, 1.0);
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
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const th = 2 * Math.PI * u;
    const ph = Math.acos(2 * v - 1);
    const r  = radius * (0.85 + Math.random() * 0.15);
    positions[3 * i]     = r * Math.sin(ph) * Math.cos(th);
    positions[3 * i + 1] = r * Math.sin(ph) * Math.sin(th);
    positions[3 * i + 2] = r * Math.cos(ph);
    sizes[i] = 0.02 + Math.random() * 0.05;
  }

  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.04,
    sizeAttenuation: true,
    color: 0xdce8ff,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });

  return new THREE.Points(geom, mat);
}

/* ════════════════════════════════════════════════════════════════
   Euclid procedural fallback
   ════════════════════════════════════════════════════════════════ */
function buildProceduralEuclid() {
  const g = new THREE.Group();

  const body   = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.55, metalness: 0.45 });
  const panel  = new THREE.MeshStandardMaterial({ color: 0x17243b, roughness: 0.25, metalness: 0.75,
                                                  emissive: 0x0a1024, emissiveIntensity: 0.35 });
  const shield = new THREE.MeshStandardMaterial({ color: 0xd7b878, roughness: 0.4,  metalness: 0.6 });
  const dark   = new THREE.MeshStandardMaterial({ color: 0x07070e, roughness: 0.2,  metalness: 0.1 });
  const gold   = new THREE.MeshStandardMaterial({ color: 0xbb9a52, roughness: 0.35, metalness: 0.8 });

  // Hexagonal sun shield (sits behind everything).
  const shieldMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.025, 6), shield);
  shieldMesh.rotation.x = Math.PI / 2;
  shieldMesh.position.z = -0.32;
  g.add(shieldMesh);

  // Gold-foil equipment ring just in front of the shield.
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.12, 24), gold);
  ring.rotation.x = Math.PI / 2;
  ring.position.z = -0.18;
  g.add(ring);

  // Main telescope body.
  const bodyMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.5, 28), body);
  bodyMesh.rotation.x = Math.PI / 2;
  bodyMesh.position.z = 0.05;
  g.add(bodyMesh);

  // Aperture (dark mirror well).
  const aperture = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 28), dark);
  aperture.rotation.x = Math.PI / 2;
  aperture.position.z = 0.32;
  g.add(aperture);

  // Secondary mirror held by three struts.
  const secondary = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), body);
  secondary.position.z = 0.5;
  g.add(secondary);
  for (let i = 0; i < 3; i++) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 6), body);
    const a = (i / 3) * Math.PI * 2;
    strut.position.set(Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0.42);
    strut.lookAt(0, 0, 0.5);
    g.add(strut);
  }

  // Solar panels — two wings behind the shield plane.
  const panelGeo = new THREE.BoxGeometry(0.8, 0.34, 0.018);
  const pL = new THREE.Mesh(panelGeo, panel);
  pL.position.set(-0.68, 0, -0.34);
  g.add(pL);
  const pR = pL.clone();
  pR.position.x = 0.68;
  g.add(pR);

  // Panel cell grid — subtle line work via wireframe overlay.
  const grid = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.34, 0.019),
    new THREE.MeshBasicMaterial({ color: 0x3a5a8c, wireframe: true, transparent: true, opacity: 0.4 }),
  );
  const gL = grid.clone(); gL.position.copy(pL.position); g.add(gL);
  const gR = grid.clone(); gR.position.copy(pR.position); g.add(gR);

  return g;
}

/* ════════════════════════════════════════════════════════════════
   Helpers
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

function easeInOut(x) {
  // Smoothstep-style: gentle at both ends, slightly biased to hold the middle.
  return x * x * (3 - 2 * x);
}

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