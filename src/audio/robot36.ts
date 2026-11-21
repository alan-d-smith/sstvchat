// Robot36 SSTV modem (VIS code 8). Pure DSP, no DOM except the ImageData type.
// Timing and colour model: docs/superpowers/specs/2026-11-21-audio-transport-design.md

export const ROBOT36 = { width: 320, height: 240, visCode: 8, lineMs: 150 } as const;

export interface Robot36Events {
  onStart?(): void;
  onRow?(index: number, row: Uint8ClampedArray): void;
  onProgress?(p: number): void;
  onDone?(): void;
  onTimeout?(): void;
}

export type Robot36State = 'waiting-vis' | 'receiving' | 'done' | 'timeout' | 'aborted';

const W = ROBOT36.width;
const H = ROBOT36.height;

// Tones (Hz).
const F_SYNC = 1200;
const F_BLACK = 1500;
const F_WHITE = 2300;
const F_LEADER = 1900;
const F_BIT1 = 1100;
const F_BIT0 = 1300;

// VIS: leader 300, break 10, leader 300, start 30, 7 data bits, parity, stop (30 each).
const VIS_MS = 300 + 10 + 300 + 30 + 7 * 30 + 30 + 30;
// Line layout (ms from the start of the sync pulse).
const SYNC_MS = 9;
const PORCH_MS = 3;
const Y_START_MS = SYNC_MS + PORCH_MS; // 12
const Y_MS = 88;
const SEP_MS = 4.5;
const PORCH2_MS = 1.5;
const C_START_MS = Y_START_MS + Y_MS + SEP_MS + PORCH2_MS; // 106
const C_MS = 44;
const LINE_MS = ROBOT36.lineMs;

const TWO_PI = 2 * Math.PI;

export function robot36DurationMs(): number {
  return VIS_MS + H * LINE_MS; // 36910
}

// ---------------------------------------------------------------- colour (BT.601, studio range)

function rgbToY(r: number, g: number, b: number): number {
  return 16 + 0.256788 * r + 0.504129 * g + 0.097906 * b;
}
function rgbToCb(r: number, g: number, b: number): number {
  return 128 - 0.148223 * r - 0.290993 * g + 0.439216 * b;
}
function rgbToCr(r: number, g: number, b: number): number {
  return 128 + 0.439216 * r - 0.367788 * g - 0.071427 * b;
}

const valueToHz = (v: number) => F_BLACK + (v * (F_WHITE - F_BLACK)) / 255;

// ---------------------------------------------------------------- modulator

/**
 * Landscape 320×240 image → Robot36 audio (VIS + 240 lines), continuous phase.
 * Length is round(robot36DurationMs() * sampleRate / 1000) samples.
 */
export function robot36Modulate(landscape: ImageData, sampleRate: number, amplitude = 0.8): Float32Array {
  if (landscape.width !== W || landscape.height !== H) {
    throw new Error(`robot36Modulate expects ${W}x${H}, got ${landscape.width}x${landscape.height}`);
  }
  const px = landscape.data;
  const Y = new Float32Array(W * H);
  const Cb = new Float32Array(W * H);
  const Cr = new Float32Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const r = px[p];
    const g = px[p + 1];
    const b = px[p + 2];
    Y[i] = rgbToY(r, g, b);
    Cb[i] = rgbToCb(r, g, b);
    Cr[i] = rgbToCr(r, g, b);
  }

  const total = Math.round((robot36DurationMs() * sampleRate) / 1000);
  const out = new Float32Array(total);
  const msToN = sampleRate / 1000;
  const dPerHz = TWO_PI / sampleRate;
  let n = 0;
  let phase = 0;
  // Emit `freq` until absolute time `endMs` (absolute times avoid cumulative rounding).
  const toneUntil = (freq: number, endMs: number) => {
    const end = Math.min(total, Math.round(endMs * msToN));
    const dp = freq * dPerHz;
    for (; n < end; n++) {
      out[n] = amplitude * Math.sin(phase);
      phase += dp;
      if (phase >= TWO_PI) phase -= TWO_PI;
    }
  };

  // VIS header.
  let t = 0;
  const seg = (freq: number, ms: number) => {
    t += ms;
    toneUntil(freq, t);
  };
  seg(F_LEADER, 300);
  seg(F_SYNC, 10);
  seg(F_LEADER, 300);
  seg(F_SYNC, 30); // start bit
  let ones = 0;
  for (let i = 0; i < 7; i++) {
    const bit = (ROBOT36.visCode >> i) & 1;
    ones += bit;
    seg(bit ? F_BIT1 : F_BIT0, 30);
  }
  seg(ones & 1 ? F_BIT1 : F_BIT0, 30); // even parity
  seg(F_SYNC, 30); // stop bit

  const yPx = Y_MS / W;
  const cPx = C_MS / W;
  for (let line = 0; line < H; line++) {
    const base = VIS_MS + line * LINE_MS;
    const even = (line & 1) === 0;
    const pair = line & ~1;
    toneUntil(F_SYNC, base + SYNC_MS);
    toneUntil(F_BLACK, base + Y_START_MS);
    const row = line * W;
    for (let x = 0; x < W; x++) toneUntil(valueToHz(Y[row + x]), base + Y_START_MS + (x + 1) * yPx);
    toneUntil(even ? F_BLACK : F_WHITE, base + Y_START_MS + Y_MS + SEP_MS);
    toneUntil(F_LEADER, base + C_START_MS);
    // Even line: R−Y (Cr), odd line: B−Y (Cb), both averaged over the line pair.
    const chroma = even ? Cr : Cb;
    const r0 = pair * W;
    const r1 = r0 + W;
    for (let x = 0; x < W; x++) {
      const v = 0.5 * (chroma[r0 + x] + chroma[r1 + x]);
      toneUntil(valueToHz(v), base + C_START_MS + (x + 1) * cPx);
    }
  }
  toneUntil(F_SYNC, robot36DurationMs()); // fills any rounding remainder (normally none)

  const fade = Math.min(total, Math.round(0.005 * sampleRate));
  for (let i = 0; i < fade; i++) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
  return out;
}

// ---------------------------------------------------------------- receiver

const RING = 1 << 16; // cumulative-frequency history, in decimated samples (~5 s at 12 kHz)
const MASK = RING - 1;
const SUB_CHUNK = 4096; // input samples demodulated between state-machine runs
// Instantaneous-frequency clamp. Wide on purpose: it only trims FM clicks. A tight clamp
// biases window means and breaks the property that, under room echo, the mean frequency
// follows the stronger (direct) path.
const F_MIN = F_LEADER - 2000;
const F_MAX = F_LEADER + 2000;
// Complex baseband low-pass around 1900 Hz. Tuned on the 15 dB loopback: lower cutoffs cut
// noise faster than they blur pixels; much below 800 Hz the 1100 Hz VIS bits suffer.
const LPF_CUTOFF = 800; // Hz
const LPF_HALF_SPAN_S = 0.0009; // taps span 1.8 ms

function lowpass(sampleRate: number, cutoff: number, len: number): Float32Array {
  const h = new Float32Array(len);
  const m = (len - 1) / 2;
  const wc = (TWO_PI * cutoff) / sampleRate;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const x = i - m;
    const sinc = x === 0 ? wc / Math.PI : Math.sin(wc * x) / (Math.PI * x);
    const win = 0.54 - 0.46 * Math.cos((TWO_PI * i) / (len - 1));
    h[i] = sinc * win;
    sum += h[i];
  }
  for (let i = 0; i < len; i++) h[i] /= sum;
  return h;
}

/**
 * Streaming Robot36 decoder. Push mic samples in any chunk size.
 *
 * Pipeline: mix to baseband at 1900 Hz → windowed-sinc low-pass (evaluated only at a
 * ~12 kHz decimated rate) → phase-difference frequency → [1 2 1]/4 smoothing → running
 * integral of frequency in a ring buffer. Every window mean (VIS bits, sync search, pixel
 * spans) is then O(1) from the integral, with fractional-sample boundaries.
 */
export class Robot36Receiver {
  private _state: Robot36State = 'waiting-vis';
  private _visCode: number | null = null;
  private readonly ev: Robot36Events;
  private readonly timeoutSamples: number;
  private samplesIn = 0;

  // Mixer + FIR.
  private readonly dec: number;
  private readonly u: number; // decimated samples per ms
  private readonly hzPerRad: number;
  private readonly rotC: number;
  private readonly rotS: number;
  private oscC = 1;
  private oscS = 0;
  private readonly taps: Float32Array;
  private readonly bufRe: Float32Array;
  private readonly bufIm: Float32Array;
  private bufPos = 0;
  private decPhase = 0;

  // Demodulator.
  private prevRe = 0;
  private prevIm = 0;
  private raw1 = F_LEADER;
  private raw2 = F_LEADER;
  /** cs[k & MASK] = Σ_{i≤k} (f_i − 1900); f_i spans decimated time [i−1, i). */
  private readonly cs = new Float64Array(RING);
  private nDec = 0;

  // VIS search: next candidate start-bit time, in ms ticks.
  private visTick = 320;

  // Line tracking (decimated-sample positions of the sync start).
  private line = 0;
  private nextSync = 0;
  private period: number;
  private readonly nominalPeriod: number;
  private misses = 0;
  private pendingJump: number | null = null;
  private readonly yEven = new Float32Array(W);
  private readonly yOdd = new Float32Array(W);
  private readonly cr = new Float32Array(W);
  private readonly cb = new Float32Array(W);

  constructor(sampleRate: number, events: Robot36Events, opts?: { visTimeoutMs?: number }) {
    this.ev = events;
    this.timeoutSamples = ((opts?.visTimeoutMs ?? 8000) * sampleRate) / 1000;
    this.dec = Math.max(1, Math.floor(sampleRate / 11000));
    const fsd = sampleRate / this.dec;
    this.u = fsd / 1000;
    this.hzPerRad = fsd / TWO_PI;
    const w0 = (TWO_PI * F_LEADER) / sampleRate;
    this.rotC = Math.cos(w0);
    this.rotS = Math.sin(w0);
    const len = 2 * Math.round(LPF_HALF_SPAN_S * sampleRate) + 1;
    this.taps = lowpass(sampleRate, LPF_CUTOFF, len);
    this.bufRe = new Float32Array(2 * len);
    this.bufIm = new Float32Array(2 * len);
    this.nominalPeriod = LINE_MS * this.u;
    this.period = this.nominalPeriod;
  }

  get state(): Robot36State {
    return this._state;
  }

  /** VIS code read from the header (null until detected). Decoding proceeds even if it is not 8. */
  get visCode(): number | null {
    return this._visCode;
  }

  push(samples: Float32Array): void {
    for (let off = 0; off < samples.length; off += SUB_CHUNK) {
      if (this._state !== 'waiting-vis' && this._state !== 'receiving') return;
      const end = Math.min(samples.length, off + SUB_CHUNK);
      this.demod(samples, off, end);
      this.samplesIn += end - off;
      if (this._state === 'waiting-vis') {
        this.scanVis();
        if (this._state === 'waiting-vis' && this.samplesIn >= this.timeoutSamples) {
          this._state = 'timeout';
          this.ev.onTimeout?.();
          return;
        }
      }
      while (this._state === 'receiving' && this.decodeLine()) {
        /* decode every line whose samples have arrived */
      }
    }
  }

  abort(): void {
    if (this._state === 'waiting-vis' || this._state === 'receiving') this._state = 'aborted';
  }

  // ------------------------------------------------------------ demodulation

  private demod(x: Float32Array, from: number, to: number): void {
    const taps = this.taps;
    const len = taps.length;
    const re = this.bufRe;
    const im = this.bufIm;
    const rc = this.rotC;
    const rs = this.rotS;
    const dec = this.dec;
    const cs = this.cs;
    const hzPerRad = this.hzPerRad;
    let c = this.oscC;
    let s = this.oscS;
    let pos = this.bufPos;
    let dp = this.decPhase;
    for (let i = from; i < to; i++) {
      const v = x[i];
      pos = pos + 1 === len ? 0 : pos + 1;
      const mr = v * c;
      const mi = -v * s;
      re[pos] = mr;
      re[pos + len] = mr;
      im[pos] = mi;
      im[pos + len] = mi;
      const nc = c * rc - s * rs;
      s = s * rc + c * rs;
      c = nc;
      if (++dp < dec) continue;
      dp = 0;
      // Low-pass output at the decimated rate (oldest..newest = pos+1..pos+len).
      let ar = 0;
      let ai = 0;
      for (let k = 0, j = pos + 1; k < len; k++, j++) {
        const h = taps[k];
        ar += h * re[j];
        ai += h * im[j];
      }
      const pr = this.prevRe;
      const pi = this.prevIm;
      this.prevRe = ar;
      this.prevIm = ai;
      const dr = ar * pr + ai * pi;
      const di = ai * pr - ar * pi;
      let f: number;
      if (dr * dr + di * di < 1e-28) {
        f = F_MAX; // digital silence: never looks like a tone
      } else {
        f = F_LEADER + Math.atan2(di, dr) * hzPerRad;
        if (f < F_MIN) f = F_MIN;
        else if (f > F_MAX) f = F_MAX;
      }
      const smooth = 0.25 * (this.raw2 + 2 * this.raw1 + f);
      this.raw2 = this.raw1;
      this.raw1 = f;
      const k = ++this.nDec;
      cs[k & MASK] = cs[(k - 1) & MASK] + (smooth - F_LEADER);
    }
    const g = 1 / Math.sqrt(c * c + s * s);
    this.oscC = c * g;
    this.oscS = s * g;
    this.bufPos = pos;
    this.decPhase = dp;
  }

  /** Integral of (f − 1900) up to decimated time x (linear between samples). */
  private C(x: number): number {
    const k = Math.floor(x);
    const a = this.cs[k & MASK];
    const fr = x - k;
    return fr === 0 ? a : a + fr * (this.cs[(k + 1) & MASK] - a);
  }

  /** Mean frequency over [a, b) in Hz. */
  private mean(a: number, b: number): number {
    return F_LEADER + (this.C(b) - this.C(a)) / (b - a);
  }

  /** Fraction of 1 ms blocks in [start, start+ms) whose mean is within tol of freq. */
  private toneFraction(start: number, ms: number, freq: number, tol: number): number {
    const u = this.u;
    let ok = 0;
    let prev = this.C(start);
    for (let i = 1; i <= ms; i++) {
      const c = this.C(start + i * u);
      if (Math.abs(F_LEADER + (c - prev) / u - freq) < tol) ok++;
      prev = c;
    }
    return ok / ms;
  }

  // ------------------------------------------------------------ VIS

  private scanVis(): void {
    const u = this.u;
    for (;;) {
      const t = this.visTick * u; // candidate start of the start bit
      if (t + 303 * u + 2 > this.nDec) return;
      this.visTick++;
      // Cheap trigger: leader just before, start bit just after.
      const a = this.mean(t - 12 * u, t - 2 * u);
      if (a < 1750 || a > 2050) continue;
      const b = this.mean(t + 3 * u, t + 27 * u);
      if (b < 1050 || b > 1350) continue;
      // Locate the leader → start-bit edge (equal windows, so the estimate is unbiased).
      let best = -Infinity;
      let edge = t;
      const w = 8 * u;
      for (let e = t - 6 * u; e <= t + 6 * u; e += 0.5) {
        const ce = this.C(e);
        const d = (2 * ce - this.C(e - w) - this.C(e + w)) / w;
        if (d > best) {
          best = d;
          edge = e;
        }
      }
      if (best < 400) continue;
      if (!this.checkVis(edge)) continue;
      this._state = 'receiving';
      this.nextSync = edge + 300 * u; // start bit + 7 bits + parity + stop
      this.ev.onStart?.();
      return;
    }
  }

  private checkVis(t: number): boolean {
    const u = this.u;
    // Leader: the 1 ms blocks must agree (noise demodulates to ~1900 Hz on average, but
    // scattered), so noise followed by the FSK 1200 Hz lead-in is not mistaken for a VIS.
    const lead0 = t - 295 * u;
    if (Math.abs(this.mean(lead0, t - 5 * u) - F_LEADER) > 60) return false;
    if (this.toneFraction(lead0, 290, F_LEADER, 150) < 0.6) return false;
    // Start/stop bits and data bits use whole-window means (robust to room echo).
    if (Math.abs(this.mean(t + 3 * u, t + 27 * u) - F_SYNC) > 80) return false;
    if (Math.abs(this.mean(t + 273 * u, t + 297 * u) - F_SYNC) > 80) return false;
    let code = 0;
    for (let i = 0; i < 8; i++) {
      const s = t + 30 * (i + 1) * u;
      const m = this.mean(s + 4 * u, s + 26 * u);
      if (m < 1020 || m > 1380 || Math.abs(m - F_SYNC) < 30) return false;
      if (i < 7 && m < F_SYNC) code |= 1 << i;
    }
    // Parity / code mismatches are tolerated: the timing already fits a VIS header.
    this._visCode = code;
    return true;
  }

  // ------------------------------------------------------------ lines

  /** Decodes the next line if its samples are available. Returns false if it must wait. */
  private decodeLine(): boolean {
    const u = this.u;
    // ±6 ms while locked. After a miss, search a whole line either way and pick the sync
    // whose separator tone has this line's parity (re-acquires after dropped audio buffers).
    const wide = this.misses > 0 && this.line < H - 1;
    const win = (wide ? LINE_MS : 6) * u;
    const pred = this.nextSync;
    if (this.nDec < pred + win + LINE_MS * u + 2 * u + 2) return false;

    const syncFound = this.findSync(pred - win, pred + win, wide);
    const found = !Number.isNaN(syncFound);

    let S = pred;
    if (found) {
      const r = syncFound - pred;
      if (this.line === 0 || this.misses > 0) {
        S = syncFound; // (re)acquire
        this.pendingJump = null;
      } else if (Math.abs(r) > 1.5 * u) {
        // A jump (e.g. dropped audio buffer) is accepted once it repeats on the next line.
        if (this.pendingJump !== null && Math.abs(r - this.pendingJump) < u) {
          S = syncFound;
          this.pendingJump = null;
        } else {
          this.pendingJump = r;
        }
      } else {
        S = pred + 0.5 * r;
        const p = this.period + 0.1 * r;
        const lim = 0.005 * this.nominalPeriod;
        this.period = Math.min(this.nominalPeriod + lim, Math.max(this.nominalPeriod - lim, p));
        this.pendingJump = null;
      }
      this.misses = 0;
    } else {
      this.misses++;
    }

    const odd = (this.line & 1) === 1;
    this.sampleSpan(S + Y_START_MS * u, (Y_MS / W) * u, odd ? this.yOdd : this.yEven);
    this.sampleSpan(S + C_START_MS * u, (C_MS / W) * u, odd ? this.cb : this.cr);
    this.nextSync = S + this.period;
    const line = this.line++;

    if (odd) {
      this.emitRow(line - 1, this.yEven);
      if (this._state !== 'receiving') return false;
      this.emitRow(line, this.yOdd);
      if (this._state !== 'receiving') return false;
    }
    this.ev.onProgress?.(this.line / H);
    if (this._state !== 'receiving') return false;
    if (this.line === H) {
      this._state = 'done';
      this.ev.onDone?.();
      return false;
    }
    return true;
  }

  /**
   * Start of the best sync pulse in [lo, hi] (decimated samples), or NaN if none.
   * Coarse: 3 × 3 ms at 1200 Hz then 3 ms porch at 1500 Hz. Fine: the sync's falling
   * edge (1200 → 1500 Hz) with equal 2 ms windows either side.
   */
  private findSync(lo: number, hi: number, checkParity: boolean): number {
    const u = this.u;
    const u3 = 3 * u;
    const dSync = F_SYNC - F_LEADER;
    const dPorch = F_BLACK - F_LEADER;
    const excluded: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      let bestCost = Infinity;
      let bestS = lo;
      scan: for (let s = lo; s <= hi; s += 1) {
        for (const x of excluded) if (Math.abs(s - x) < 20 * u) continue scan;
        const c0 = this.C(s);
        const c1 = this.C(s + u3);
        const c2 = this.C(s + 2 * u3);
        const c3 = this.C(s + 3 * u3);
        const c4 = this.C(s + 4 * u3);
        const cost =
          Math.abs((c1 - c0) / u3 - dSync) +
          Math.abs((c2 - c1) / u3 - dSync) +
          Math.abs((c3 - c2) / u3 - dSync) +
          Math.abs((c4 - c3) / u3 - dPorch);
        if (cost < bestCost) {
          bestCost = cost;
          bestS = s;
        }
      }
      if (bestCost / 4 >= 100) return NaN;

      const e0 = bestS + SYNC_MS * u;
      const w = 2 * u;
      let bestE = -Infinity;
      let edge = e0;
      for (let e = e0 - 0.6 * u; e <= e0 + 0.6 * u; e += 0.25) {
        const d = (this.C(e + w) - 2 * this.C(e) + this.C(e - w)) / w;
        if (d > bestE) {
          bestE = d;
          edge = e;
        }
      }
      const s = edge - SYNC_MS * u;
      if (bestE >= 150) {
        if (!checkParity) return s;
        // Separator: 1500 Hz before R−Y (even lines), 2300 Hz before B−Y (odd lines).
        const sep = this.mean(s + 100.5 * u, s + 104 * u);
        if ((sep < F_LEADER) === ((this.line & 1) === 0)) return s;
      }
      if (!checkParity) return NaN;
      excluded.push(bestS);
    }
    return NaN;
  }

  /** Average frequency over W consecutive spans of `step` samples → 0..255. */
  private sampleSpan(start: number, step: number, out: Float32Array): void {
    const k = 255 / (F_WHITE - F_BLACK);
    const off = F_LEADER - F_BLACK;
    let prev = this.C(start);
    for (let x = 0; x < W; x++) {
      const c = this.C(start + (x + 1) * step);
      const v = ((c - prev) / step + off) * k;
      out[x] = v < 0 ? 0 : v > 255 ? 255 : v;
      prev = c;
    }
  }

  private emitRow(index: number, y: Float32Array): void {
    const row = new Uint8ClampedArray(W * 4);
    for (let x = 0, p = 0; x < W; x++, p += 4) {
      const yy = 1.164383 * (y[x] - 16);
      const cb = this.cb[x] - 128;
      const cr = this.cr[x] - 128;
      row[p] = yy + 1.596027 * cr;
      row[p + 1] = yy - 0.391762 * cb - 0.812968 * cr;
      row[p + 2] = yy + 2.017232 * cb;
      row[p + 3] = 255;
    }
    this.ev.onRow?.(index, row);
  }
}
