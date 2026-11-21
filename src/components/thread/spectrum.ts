// Maths behind the receiving-text spectrogram: a small radix-2 FFT, the live analyser that turns
// mic chunks into normalised 500–3000 Hz columns, and a synthetic two-tone generator for receives
// that are only simulated (demo panel, mock chats). Buffers are allocated once, never per frame.

import { FSK } from '../../audio/fsk';

/** Frequency span shown, bottom to top. */
export const LOW_HZ = 500;
export const HIGH_HZ = 3000;
/** Rows per column; row 0 is HIGH_HZ (top), row GRID - 1 is LOW_HZ (bottom). */
export const GRID = 96;

/** Fraction from the top (0..1) at which `hz` sits. */
export const hzToTop = (hz: number) => (HIGH_HZ - hz) / (HIGH_HZ - LOW_HZ);
const gridHz = (row: number) => HIGH_HZ - (row * (HIGH_HZ - LOW_HZ)) / (GRID - 1);

/** ~10 ms analysis window: short enough that 100-baud bits stay distinct. */
export const fftSizeFor = (sampleRate: number) => (sampleRate > 64000 ? 1024 : 512);

/** In-place iterative radix-2 FFT with precomputed twiddles and bit reversal. */
export class Fft {
  readonly n: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
    this.n = n;
    const bits = Math.round(Math.log2(n));
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / n);
      this.sin[k] = -Math.sin((2 * Math.PI * k) / n);
    }
  }

  transform(re: Float32Array, im: Float32Array): void {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step];
          const wi = sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * Hann-windowed magnitude spectrum of one frame (length a power of two), bins 0..n/2, scaled so
 * a full-scale sine on a bin centre reads 1.
 */
export function magnitudeSpectrum(frame: Float32Array): Float32Array {
  const n = frame.length;
  const fft = new Fft(n);
  const w = hann(n);
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i] * w[i];
  fft.transform(re, im);
  const out = new Float32Array(n / 2 + 1);
  for (let b = 0; b <= n / 2; b++) out[b] = (Math.hypot(re[b], im[b]) * 4) / n;
  return out;
}

/** dB span from the loudest recent bin down to transparent. */
const RANGE_DB = 30;
/** The reference never drops below this, so a quiet room stays a faint haze instead of full scale. */
const MIN_REF_DB = -50;
/** How fast the reference falls back after a loud signal stops. */
const REF_DECAY_DB_PER_S = 12;

/**
 * Live analyser: feed it mic chunks of any length; every hop (50% overlap) it calls `onColumn`
 * with GRID intensities in 0..1 (the same array each time: copy it if you keep it).
 */
export class ColumnAnalyser {
  readonly framesPerSecond: number;
  private readonly n: number;
  private readonly hop: number;
  private readonly fft: Fft;
  private readonly win: Float32Array;
  private readonly ring: Float32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly db: Float32Array;
  private readonly bin0: Uint16Array;
  private readonly binFrac: Float32Array;
  private readonly col = new Float32Array(GRID);
  private readonly decay: number;
  private pos = 0;
  private filled = 0;
  private sinceHop = 0;
  private refDb = MIN_REF_DB;

  constructor(sampleRate: number, private readonly onColumn: (col: Float32Array) => void) {
    this.n = fftSizeFor(sampleRate);
    this.hop = this.n / 2;
    this.framesPerSecond = sampleRate / this.hop;
    this.decay = REF_DECAY_DB_PER_S / this.framesPerSecond;
    this.fft = new Fft(this.n);
    this.win = hann(this.n);
    this.ring = new Float32Array(this.n);
    this.re = new Float32Array(this.n);
    this.im = new Float32Array(this.n);
    const hzPerBin = sampleRate / this.n;
    this.db = new Float32Array(Math.min(this.n / 2, Math.ceil(HIGH_HZ / hzPerBin) + 1) + 1);
    this.bin0 = new Uint16Array(GRID);
    this.binFrac = new Float32Array(GRID);
    for (let r = 0; r < GRID; r++) {
      const b = Math.min(gridHz(r) / hzPerBin, this.db.length - 1.001);
      this.bin0[r] = Math.floor(b);
      this.binFrac[r] = b - Math.floor(b);
    }
  }

  push(chunk: Float32Array): void {
    const mask = this.n - 1;
    for (let i = 0; i < chunk.length; i++) {
      this.ring[this.pos] = chunk[i];
      this.pos = (this.pos + 1) & mask;
      if (this.filled < this.n) this.filled++;
      if (++this.sinceHop >= this.hop && this.filled === this.n) {
        this.sinceHop = 0;
        this.frame();
      }
    }
  }

  private frame() {
    const { n, re, im, win, ring, db, col } = this;
    const mask = n - 1;
    for (let i = 0; i < n; i++) {
      re[i] = ring[(this.pos + i) & mask] * win[i]; // oldest sample first
      im[i] = 0;
    }
    this.fft.transform(re, im);
    const scale = 4 / n;
    for (let b = 0; b < db.length; b++) {
      db[b] = 20 * Math.log10(Math.hypot(re[b], im[b]) * scale + 1e-9);
    }
    let max = -Infinity;
    for (let r = 0; r < GRID; r++) {
      const b = this.bin0[r];
      const f = this.binFrac[r];
      const v = db[b] + (db[b + 1] - db[b]) * f;
      col[r] = v;
      if (v > max) max = v;
    }
    this.refDb = Math.max(max, this.refDb - this.decay, MIN_REF_DB);
    const floor = this.refDb - RANGE_DB;
    for (let r = 0; r < GRID; r++) col[r] = Math.min(1, Math.max(0, (col[r] - floor) / RANGE_DB));
    this.onColumn(col);
  }
}

const CHARSET = 'abcdefghijklmnopqrstuvwxyz      eetaoinsr.,!?';
const BIT_RING = 256;
/** Tone width (Hz, gaussian sigma) roughly matching a 10 ms Hann window's main lobe. */
const TONE_SIGMA_HZ = 78;

/**
 * Plausible two-tone columns for simulated receives: UART-framed bytes (start 0 = space 2200 Hz,
 * 8 data bits, stop 1 = mark 1200 Hz) at 100 baud with idle-mark pauses and a light noise floor,
 * normalised like ColumnAnalyser's output.
 */
export class SynthFsk {
  readonly framesPerSecond: number;
  private readonly markShape = new Float32Array(GRID);
  private readonly spaceShape = new Float32Array(GRID);
  private readonly bits = new Uint8Array(BIT_RING);
  private made = 0;
  private bytesSinceIdle = 0;
  private t = 0;
  private seed: number;

  /** `calm`: no speckles or level flicker (prefers-reduced-motion). */
  constructor(framesPerSecond = 187.5, private calm = false, seed = 0x9e3779b9) {
    this.framesPerSecond = framesPerSecond;
    this.seed = seed >>> 0 || 1;
    for (let r = 0; r < GRID; r++) {
      const hz = gridHz(r);
      this.markShape[r] = Math.exp(-0.5 * ((hz - FSK.mark) / TONE_SIGMA_HZ) ** 2);
      this.spaceShape[r] = Math.exp(-0.5 * ((hz - FSK.space) / TONE_SIGMA_HZ) ** 2);
    }
  }

  setCalm(calm: boolean) {
    this.calm = calm;
  }

  /** xorshift32 in [0, 1). */
  private rand() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  private emit(bit: number) {
    this.bits[this.made++ % BIT_RING] = bit;
  }

  private queueMore() {
    if (this.bytesSinceIdle > 10 && this.rand() < 0.25) {
      const idle = 6 + Math.floor(this.rand() * 14);
      for (let i = 0; i < idle; i++) this.emit(1);
      this.bytesSinceIdle = 0;
      return;
    }
    const byte = CHARSET.charCodeAt(Math.floor(this.rand() * CHARSET.length));
    this.emit(0);
    for (let k = 0; k < 8; k++) this.emit((byte >> k) & 1);
    this.emit(1);
    this.bytesSinceIdle++;
  }

  private bit(index: number) {
    while (this.made <= index) this.queueMore();
    return this.bits[index % BIT_RING];
  }

  /** Writes the next column (GRID values in 0..1) into `out`. */
  next(out: Float32Array): void {
    const dt = 1 / this.framesPerSecond;
    this.t += dt;
    // Share of a ~10 ms window spent on mark, sampled at five points so bit edges blend.
    let mark = 0;
    for (let s = 0; s < 5; s++) mark += this.bit(Math.floor((this.t + (s - 2) * 0.0025) * FSK.baud));
    mark /= 5;
    const level = this.calm ? 0.9 : 0.82 + 0.18 * this.rand();
    for (let r = 0; r < GRID; r++) {
      const tone = level * (mark * this.markShape[r] + (1 - mark) * this.spaceShape[r]);
      let noise = 0.004 + 0.006 * this.rand();
      if (!this.calm && this.rand() < 0.004) noise += 0.03 * this.rand();
      const db = 20 * Math.log10(tone + noise);
      out[r] = Math.min(1, Math.max(0, (db + RANGE_DB) / RANGE_DB));
    }
  }
}

/** Packs RGBA bytes into the platform's native Uint32 pixel order. */
const pixels = new Uint32Array(1);
const pixelBytes = new Uint8ClampedArray(pixels.buffer);
function pack(r: number, g: number, b: number, a: number) {
  pixelBytes[0] = r;
  pixelBytes[1] = g;
  pixelBytes[2] = b;
  pixelBytes[3] = a;
  return pixels[0];
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export type Rgb = readonly [number, number, number];

/**
 * 256-entry colour map: transparent → `tone` (the sender's colour) → `peak` (a mix of the sender's
 * colour and the text colour, so the core is pale in dark mode and deep in light mode).
 */
export function buildColorMap(tone: Rgb, text: Rgb, out = new Uint32Array(256)): Uint32Array {
  const peak = [0, 1, 2].map((i) => tone[i] + (text[i] - tone[i]) * 0.45);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const a = smooth(0.3, 0.78, x);
    const p = smooth(0.62, 1, x);
    out[i] = pack(
      tone[0] + (peak[0] - tone[0]) * p,
      tone[1] + (peak[1] - tone[1]) * p,
      tone[2] + (peak[2] - tone[2]) * p,
      a * 255,
    );
  }
  return out;
}

/** Parses the `#rrggbb` / `rgb(a)(…)` strings a canvas context normalises colours to. */
export function parseRgb(s: string): Rgb | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (hex) {
    const v = parseInt(hex[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s.trim());
  return fn ? [Number(fn[1]), Number(fn[2]), Number(fn[3])] : null;
}
