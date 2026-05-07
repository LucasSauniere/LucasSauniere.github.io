// Math-generated PSF on a canvas. No FFT needed — analytical composition.
// opts.aberration: 0 (diffraction-limited) → ~1.5 (heavily aberrated)
// opts.noise:      0 → ~0.2 (shot-noise amplitude)
export function renderPSF(canvas, opts = {}) {
  const { aberration = 0, noise = 0 } = opts;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const img = ctx.createImageData(W, H);
  const data = img.data;

  const cx = W / 2, cy = H / 2;
  const sigma = 3.5 + aberration * 9;      // core widens with aberration
  const ringK = 0.9 - aberration * 0.5;    // Airy rings fade when aberrated
  const coma  = aberration * 0.65;         // asymmetric tail
  const astig = aberration * 0.45;         // anisotropic width
  const theta = 0.7;
  const cosT = Math.cos(theta), sinT = Math.sin(theta);

  const buf = new Float32Array(W * H);
  let peak = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx0 = x - cx, dy0 = y - cy;
      const u =  dx0 * cosT + dy0 * sinT;
      const v = -dx0 * sinT + dy0 * cosT;

      const sx = sigma * (1 + astig);
      const sy = sigma * (1 - astig * 0.7);
      const r2 = (u*u)/(sx*sx) + (v*v)/(sy*sy);

      const r = Math.sqrt(dx0*dx0 + dy0*dy0);
      const core = Math.exp(-r2 * 0.5);
      const comaBoost = Math.exp(
        -Math.pow((u - coma * 11) / (sigma * 1.8), 2) - (v*v)/(sigma*sigma*2)
      ) * coma * 0.8;
      const rings = Math.max(0, 1 - aberration) *
                    0.15 * Math.pow(Math.cos(r * ringK * 0.6), 2) *
                    Math.exp(-r / 32);

      let val = core + comaBoost + rings;

      if (noise > 0) {
        // approximate Poisson shot noise via scaled Gaussian
        const n = (Math.random() + Math.random() + Math.random() - 1.5) * 0.85;
        val += n * noise * Math.sqrt(Math.max(val, 0.01));
      }

      buf[y*W + x] = val;
      if (val > peak) peak = val;
    }
  }

  const inv = 1 / Math.max(peak, 1e-6);
  for (let i = 0; i < buf.length; i++) {
    let v = Math.max(0, Math.min(1, buf[i] * inv));
    v = Math.pow(v, 0.55);  // gamma for visual contrast

    // Dark navy → cyan → white colormap
    const r = Math.round(255 * Math.pow(v, 2.5));
    const g = Math.round(255 * Math.pow(v, 1.3));
    const b = Math.round(255 * Math.min(1, 0.25 + v));
    const j = i * 4;
    data[j] = r; data[j+1] = g; data[j+2] = b; data[j+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}