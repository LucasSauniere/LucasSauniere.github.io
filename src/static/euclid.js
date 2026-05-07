// euclid.js — pinned Three.js scene for the Euclid section.
// Loads a Draco-compressed GLB if present at ./euclid.glb; falls back to a
// procedural wireframe telescope if the GLB is missing.
import * as THREE from 'three';
import { GLTFLoader }  from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const GLB_URL = './euclid.glb';  // ← change to '/static/euclid.glb' if needed

const canvas = document.getElementById('euclidCanvas');
if (!canvas) throw new Error('euclidCanvas not found');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setClearColor(0x000000, 1);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
camera.position.set(0, 0, 8);

// Subtle starfield behind the model
(function addStars() {
  const geom = new THREE.BufferGeometry();
  const n = 1500;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 40 + Math.random() * 30;
    const t = Math.random() * Math.PI * 2;
    const p = Math.acos(2 * Math.random() - 1);
    pos[i*3]   = r * Math.sin(p) * Math.cos(t);
    pos[i*3+1] = r * Math.sin(p) * Math.sin(t);
    pos[i*3+2] = r * Math.cos(p);
  }
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geom, new THREE.PointsMaterial({
    size: 0.08, color: 0xffffff, transparent: true, opacity: 0.8,
  })));
})();

scene.add(new THREE.AmbientLight(0x6080ff, 0.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(5, 3, 5);
scene.add(sun);

// Model root — filled once GLB loads or fallback is built
const modelRoot = new THREE.Group();
scene.add(modelRoot);

function buildFallback() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xcfd6e4, metalness: 0.6, roughness: 0.35,
    wireframe: true,
  });
  // main barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.2, 24), mat);
  barrel.rotation.x = Math.PI / 2;
  g.add(barrel);
  // sunshield cone
  const shield = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.8, 32, 1, true), mat);
  shield.rotation.x = Math.PI / 2;
  shield.position.z = -1.3;
  g.add(shield);
  // solar panels
  const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, 1.0), mat);
  panel.position.z = 0.3;
  g.add(panel);
  modelRoot.add(g);
}

// Try to load the GLB
const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

loader.load(
  GLB_URL,
  gltf => {
    const obj = gltf.scene;
    // Center and scale to fit ~3 units
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    obj.scale.setScalar(3 / maxDim);

    // Soft overlay if materials are missing
    obj.traverse(m => {
      if (m.isMesh && !m.material) {
        m.material = new THREE.MeshStandardMaterial({
          color: 0xcfd6e4, metalness: 0.5, roughness: 0.4,
        });
      }
    });
    modelRoot.add(obj);
  },
  undefined,
  err => {
    console.warn('euclid.glb not found, using procedural fallback.', err);
    buildFallback();
  }
);

// Scroll-driven rotation via ScrollTrigger (pin the wrapper)
let progress = 0;
ScrollTrigger.create({
  trigger: '#euclid-section',
  pin: '.euclid-pin',
  start: 'top top',
  end: '+=200%',
  scrub: true,
  onUpdate: self => { progress = self.progress; },
});

function resize() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function animate() {
  modelRoot.rotation.y = progress * Math.PI * 2;
  modelRoot.rotation.x = Math.sin(progress * Math.PI) * 0.3;
  camera.position.z = 8 - progress * 2;
  renderer.render(scene, camera);
  if (!reduceMotion) requestAnimationFrame(animate);
}
animate();