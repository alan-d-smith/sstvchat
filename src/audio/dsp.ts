// Small DSP helpers shared by the modems and their tests.

/** Linear-interpolation resampler (no anti-alias filter; fine for tones well below Nyquist). */
export function resampleLinear(x: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (x.length === 0 || fromRate === toRate) return x.slice();
  const step = fromRate / toRate;
  const n = Math.floor((x.length - 1) / step) + 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i * step;
    const i0 = Math.floor(t);
    const f = t - i0;
    out[i] = i0 + 1 < x.length ? x[i0] + f * (x[i0 + 1] - x[i0]) : x[i0];
  }
  return out;
}
