// Deterministic acoustic channel for the modem tests (test-only, never bundled): seeded noise,
// crowd babble, a small-speaker/mic response and room echo.

import { Fft, hann } from '../components/thread/spectrum';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
}

/** Fast approximate unit Gaussian (Irwin–Hall, 4 uniforms) for bulk noise. */
function noise(rand: () => number): number {
  return (rand() + rand() + rand() + rand() - 2) * 1.7320508;
}

export function rms(x: Float32Array, from = 0, to = x.length): number {
  let e = 0;
  for (let i = from; i < to; i++) e += x[i] * x[i];
  return Math.sqrt(e / Math.max(1, to - from));
}

/* ---------------------------------------------------------------- filters */

type Coeffs = [b0: number, b1: number, b2: number, a1: number, a2: number];

/** RBJ cookbook biquads (normalised, a0 = 1). */
const rbj = {
  bandpass(rate: number, f: number, q: number): Coeffs {
    const w = (2 * Math.PI * f) / rate;
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    return [al / a0, 0, -al / a0, (-2 * Math.cos(w)) / a0, (1 - al) / a0];
  },
  lowpass(rate: number, f: number, q: number): Coeffs {
    const w = (2 * Math.PI * f) / rate;
    const al = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a0 = 1 + al;
    return [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0];
  },
  highpass(rate: number, f: number, q: number): Coeffs {
    const w = (2 * Math.PI * f) / rate;
    const al = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a0 = 1 + al;
    return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0];
  },
  peaking(rate: number, f: number, q: number, db: number): Coeffs {
    const A = Math.pow(10, db / 40);
    const w = (2 * Math.PI * f) / rate;
    const al = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a0 = 1 + al / A;
    return [(1 + al * A) / a0, (-2 * c) / a0, (1 - al * A) / a0, (-2 * c) / a0, (1 - al / A) / a0];
  },
};

/** Applies a biquad cascade, returning a new array. */
function filter(x: Float32Array, stages: Coeffs[]): Float32Array {
  const y = Float32Array.from(x);
  for (const [b0, b1, b2, a1, a2] of stages) {
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = y[i];
      const o = b0 * v + z1;
      z1 = b1 * v - a1 * o + z2;
      z2 = b2 * v - a2 * o;
      y[i] = o;
    }
  }
  return y;
}

/* ---------------------------------------------------------------- noise */

/** Pink (−3 dB/octave) noise, unit RMS (Paul Kellet's refined filter on white noise). */
export function pinkNoise(n: number, rand: () => number): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = noise(rand);
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  const k = 1 / Math.max(rms(out), 1e-12);
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

/* ---------------------------------------------------------------- babble */

/**
 * One talker: a glottal pulse train (90–250 Hz pitch with intonation and jitter, −12 dB/octave
 * pulse shape, +6 dB/octave lip radiation) through three parallel formant resonators that glide
 * to new vowel targets (F1 300–900, F2 900–2400, F3 2300–3000 Hz) every syllable; syllables at
 * 3–6 Hz with a raised-sine envelope, pauses between phrases, and a fricative onset (/s/, /ʃ/
 * noise) on some syllables.
 */
function talker(n: number, rate: number, rand: () => number): Float32Array {
  const out = new Float32Array(n);
  const f0 = 90 + 160 * rand();
  const sylRate = 3 + 3 * rand();
  const intonation = 0.3 + 0.5 * rand(); // Hz
  const phase0 = 2 * Math.PI * rand();
  const gLp = Math.exp((-2 * Math.PI * 150) / rate); // glottal pulse shape: two poles at 150 Hz
  const BLOCK = 32; // formant coefficients are updated per block
  const LOW_GAIN = 1.5;

  // Syllable plan: [start, length, level, F1, F2, F3, fricative?]
  type Syl = { at: number; len: number; amp: number; f: [number, number, number]; fric: null | { len: number; fc: number; q: number; amp: number } };
  const syls: Syl[] = [];
  let at = -Math.floor(rand() * (rate / sylRate)); // start mid-utterance
  let inPhrase = 0;
  while (at < n) {
    const len = Math.round((rate / sylRate) * (0.6 + 0.8 * rand()));
    if (inPhrase > 4 + 6 * rand()) {
      at += Math.round(rate * (0.2 + 0.6 * rand())); // pause between phrases
      inPhrase = 0;
      continue;
    }
    inPhrase++;
    const f1 = 300 + 600 * rand();
    const f2 = Math.max(f1 + 300, 900 + 1500 * rand());
    const f3 = Math.max(f2 + 250, 2300 + 700 * rand());
    const sh = rand() < 0.4;
    syls.push({
      at,
      len,
      amp: Math.pow(10, (-9 * rand()) / 20),
      f: [f1, Math.min(f2, 2400), Math.min(f3, 3000)],
      fric: rand() < 0.35 ? { len: Math.round(rate * (0.05 + 0.09 * rand())), fc: sh ? 2500 + 1000 * rand() : 4000 + 3000 * rand(), q: 1.2 + rand(), amp: Math.pow(10, (-6 - 10 * rand()) / 20) } : null,
    });
    at += len;
  }

  // Voiced part.
  let nextPulse = 0;
  let g1 = 0;
  let g2 = 0;
  let prev = 0;
  let z10 = 0, z11 = 0, z20 = 0, z21 = 0, z30 = 0, z31 = 0, z40 = 0, z41 = 0;
  // A wide, fixed low resonance (the vocal tract passes harmonics below F1; parallel band-passes
  // alone would not) keeps the speech spectrum's 200–500 Hz bulk.
  const [l0, , , l1, l2] = rbj.bandpass(rate, 300, 0.8);
  const cur = [500, 1500, 2500];
  const c = new Float64Array(9); // per formant: b0, a1, a2 (bandpass: b1 = 0, b2 = -b0)
  let si = 0;
  const envAt = (i: number) => {
    while (si < syls.length && syls[si].at + syls[si].len <= i) si++;
    const s = syls[si];
    return s && i >= s.at ? s.amp * Math.pow(Math.sin((Math.PI * (i - s.at)) / s.len), 1.5) : 0;
  };
  for (let b = 0; b < n; b += BLOCK) {
    const end = Math.min(n, b + BLOCK);
    const e0 = envAt(b);
    const s = syls[si];
    for (let k = 0; k < 3; k++) {
      // Glide 4 % of the way to this syllable's vowel each block (~17 ms time constant at 48 kHz).
      if (s) cur[k] += 0.04 * (s.f[k] - cur[k]);
      const [b0, , , a1, a2] = rbj.bandpass(rate, cur[k], cur[k] / (60 + 40 * k));
      c[3 * k] = b0;
      c[3 * k + 1] = a1;
      c[3 * k + 2] = a2;
    }
    const e1 = envAt(end);
    const [p0, p1, p2, q0, q1, q2, r0, r1, r2] = c;
    for (let i = b; i < end; i++) {
      let e = 0;
      if (i >= nextPulse) {
        e = 1;
        const pitch = f0 * (1 + 0.12 * Math.sin(2 * Math.PI * intonation * (i / rate) + phase0));
        nextPulse += (rate / pitch) * (1 + 0.015 * gaussian(rand));
      }
      g1 = gLp * g1 + (1 - gLp) * e;
      g2 = gLp * g2 + (1 - gLp) * g1;
      const src = g2 - prev; // lip radiation
      prev = g2;
      const o1 = p0 * src + z10;
      z10 = -p1 * o1 + z11;
      z11 = -p0 * src - p2 * o1;
      const o2 = q0 * src + z20;
      z20 = -q1 * o2 + z21;
      z21 = -q0 * src - q2 * o2;
      const o3 = r0 * src + z30;
      z30 = -r1 * o3 + z31;
      z31 = -r0 * src - r2 * o3;
      const o4 = l0 * src + z40;
      z40 = -l1 * o4 + z41;
      z41 = -l0 * src - l2 * o4;
      out[i] = (e0 + ((e1 - e0) * (i - b)) / BLOCK) * (o1 + 0.7 * o2 + 0.45 * o3 + LOW_GAIN * o4);
    }
  }
  // Normalise the voiced part to unit RMS over its active time, then add fricative onsets.
  let active = 0;
  for (const s of syls) active += Math.max(0, Math.min(n, s.at + s.len) - Math.max(0, s.at));
  const vr = rms(out) * Math.sqrt(n / Math.max(1, active));
  if (vr > 0) for (let i = 0; i < n; i++) out[i] /= vr;
  for (const s of syls) {
    if (!s.fric) continue;
    const { len, fc, q, amp } = s.fric;
    const start = s.at - Math.round(len * 0.6);
    const hiss = new Float32Array(len);
    for (let i = 0; i < len; i++) hiss[i] = noise(rand);
    const shaped = filter(hiss, [rbj.bandpass(rate, fc, q), rbj.highpass(rate, 1800, 0.7)]);
    const k = amp / Math.max(rms(shaped), 1e-12);
    for (let i = 0; i < len; i++) {
      const j = start + i;
      if (j >= 0 && j < n) out[j] += k * shaped[i] * Math.sin((Math.PI * i) / len);
    }
  }
  return out;
}

export interface BabbleOptions {
  /** Overlapping talkers (default 5). */
  talkers?: number;
  /** Pink-noise floor relative to the talkers (default −12 dB). */
  pinkDb?: number;
  /** Room echo on the crowd (default true). */
  echo?: boolean;
}

/**
 * Crowd chatter ("babble") at `rate`, unit RMS: several talkers at random levels (±4 dB) plus a
 * pink-noise floor, optionally through a reverberant room. Its long-term spectrum follows speech:
 * flat to ~500 Hz, then about −7 to −8 dB/octave (ANSI S3.5's speech spectrum: 2 kHz ≈ −8 dB,
 * 4 kHz ≈ −16 dB relative to 1 kHz; this model is a little brighter, i.e. harsher on high tones).
 */
export function babble(n: number, rate: number, seed: number, opts: BabbleOptions = {}): Float32Array {
  const { talkers = 5, pinkDb = -12, echo = true } = opts;
  const rand = mulberry32(seed * 7919 + 17);
  let mix: Float32Array = new Float32Array(n);
  for (let t = 0; t < talkers; t++) {
    const v = talker(n, rate, rand);
    const g = Math.pow(10, (8 * rand() - 4) / 20);
    for (let i = 0; i < n; i++) mix[i] += g * v[i];
  }
  const pk = Math.pow(10, pinkDb / 20) * rms(mix);
  const pink = pinkNoise(n, rand);
  for (let i = 0; i < n; i++) mix[i] += pk * pink[i];
  if (echo) mix = room(mix, rate, seed + 101, 0.5, 3).subarray(0, n);
  const k = 1 / Math.max(rms(mix), 1e-12);
  for (let i = 0; i < n; i++) mix[i] *= k;
  return mix;
}

/* ---------------------------------------------------------------- speaker, mic, room */

/**
 * Small loudspeaker + mic response (three profiles): a phone-like driver (rolls off below ~800 Hz,
 * presence peak near 3 kHz, gone above ~8 kHz), a laptop pair (lower f0, softer top) and a cheap
 * speaker (tilted, dull above ~5 kHz). All through a mic high-pass at 100 Hz.
 */
export function speaker(x: Float32Array, rate: number, profile = 0): Float32Array {
  const stages: Coeffs[][] = [
    [rbj.highpass(rate, 800, 0.9), rbj.peaking(rate, 3000, 0.9, 4), rbj.lowpass(rate, 8000, 0.7)],
    [rbj.highpass(rate, 500, 0.8), rbj.peaking(rate, 2500, 1.2, 3), rbj.lowpass(rate, 7000, 0.6)],
    [rbj.highpass(rate, 1000, 1.1), rbj.peaking(rate, 2000, 0.8, 5), rbj.lowpass(rate, 5500, 0.6)],
  ];
  return filter(x, [...stages[profile % stages.length], rbj.highpass(rate, 100, 0.7)]);
}

/** Room-ish channel: early reflection + exponentially decaying diffuse tail at `drDb` direct-to-reverb. */
export function room(sig: Float32Array, rate: number, seed: number, rt60 = 0.3, drDb = 8, early = 0.4): Float32Array {
  const rand = mulberry32(seed);
  const len = Math.round(rate * rt60);
  const delays: number[] = [];
  const gains: number[] = [];
  let e = 0;
  for (let d = Math.round(rate * 0.003); d < len; d += Math.round(rate * 0.002)) {
    const g = gaussian(rand) * Math.pow(10, (-3 * d) / len);
    delays.push(d + Math.floor(rand() * rate * 0.002));
    gains.push(g);
    e += g * g;
  }
  const k = Math.sqrt(Math.pow(10, -drDb / 10) / e);
  for (let t = 0; t < gains.length; t++) gains[t] *= k;
  delays.push(Math.round(rate * 0.0013));
  gains.push(early);
  const y = new Float32Array(sig.length + len + Math.round(rate * 0.002));
  y.set(sig);
  for (let t = 0; t < delays.length; t++) {
    const d = delays[t];
    const g = gains[t];
    for (let i = 0; i < sig.length; i++) y[i + d] += g * sig[i];
  }
  return y;
}

/* ---------------------------------------------------------------- analysis */

/** Long-term spectrum (Welch, Hann, 50 % overlap): mean power density in dB over ±1/6 octave around each centre. */
export function bandLevels(x: Float32Array, rate: number, centres: number[], n = 2048): number[] {
  const fft = new Fft(n);
  const w = hann(n);
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const psd = new Float64Array(n / 2 + 1);
  for (let s = 0; s + n <= x.length; s += n / 2) {
    for (let i = 0; i < n; i++) {
      re[i] = x[s + i] * w[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let k = 0; k <= n / 2; k++) psd[k] += re[k] * re[k] + im[k] * im[k];
  }
  return centres.map((f) => {
    const lo = Math.ceil((f * Math.pow(2, -1 / 6) * n) / rate);
    const hi = Math.floor((f * Math.pow(2, 1 / 6) * n) / rate);
    let p = 0;
    for (let k = lo; k <= hi; k++) p += psd[k];
    return 10 * Math.log10(p / Math.max(1, hi - lo + 1) + 1e-30);
  });
}
