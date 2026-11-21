import { describe, expect, it } from 'vitest';
import { ROBOT36, Robot36Receiver, robot36DurationMs, robot36Modulate } from './robot36';

// ---------------------------------------------------------------- helpers

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Linear-interpolation resampler. */
function resampleLinear(x: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate;
  const n = Math.floor((x.length - 1) / ratio) + 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const k = Math.floor(p);
    const f = p - k;
    out[i] = k + 1 < x.length ? x[k] + f * (x[k + 1] - x[k]) : x[k];
  }
  return out;
}

/** Leading/trailing silence, gain, white noise at `snrDb` (vs. the signal), resample. */
function impair(
  tx: Float32Array,
  o: { rate: number; toRate: number; snrDb: number; gain: number; seed: number; ppm?: number },
): Float32Array {
  const lead = Math.round(0.5 * o.rate);
  const tail = Math.round(0.3 * o.rate);
  const sig = new Float32Array(lead + tx.length + tail);
  let p = 0;
  for (let i = 0; i < tx.length; i++) {
    const v = tx[i] * o.gain;
    sig[lead + i] = v;
    p += v * v;
  }
  const sigma = Math.sqrt(p / tx.length / 10 ** (o.snrDb / 10));
  const rng = mulberry32(o.seed);
  for (let i = 0; i < sig.length; i++) sig[i] += sigma * gaussian(rng);
  // A transmitter clock that is fast by `ppm` plays the samples at rate·(1+ppm).
  return resampleLinear(sig, o.rate * (1 + (o.ppm ?? 0) * 1e-6), o.toRate);
}

const PALETTE: [number, number, number][] = [
  [0, 0, 0], [255, 255, 255], [220, 30, 30], [30, 180, 60], [40, 70, 220], [240, 220, 40],
  [30, 200, 210], [200, 40, 190], [250, 140, 20], [128, 128, 128], [60, 60, 60], [120, 40, 160],
  [20, 120, 120], [250, 170, 190], [120, 70, 30], [150, 200, 250], [190, 230, 120], [90, 20, 30],
];

/** 8×6 grid of flat 40×40 colour blocks. */
function testImage(): ImageData {
  const img = new ImageData(ROBOT36.width, ROBOT36.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [r, g, b] = PALETTE[(Math.floor(x / 40) * 5 + Math.floor(y / 40) * 7) % PALETTE.length];
      const p = (y * img.width + x) * 4;
      img.data[p] = r;
      img.data[p + 1] = g;
      img.data[p + 2] = b;
      img.data[p + 3] = 255;
    }
  }
  return img;
}

function decode(audio: Float32Array, sampleRate: number, seed: number) {
  const rows: number[] = [];
  const img = new Uint8ClampedArray(ROBOT36.width * ROBOT36.height * 4);
  const log = { start: 0, done: 0, timeout: 0, progress: 0, alphaOk: true };
  const rx = new Robot36Receiver(sampleRate, {
    onStart: () => log.start++,
    onRow: (i, row) => {
      rows.push(i);
      expect(row.length).toBe(ROBOT36.width * 4);
      for (let p = 3; p < row.length; p += 4) if (row[p] !== 255) log.alphaOk = false;
      img.set(row, i * ROBOT36.width * 4);
    },
    onProgress: (p) => (log.progress = p),
    onDone: () => log.done++,
    onTimeout: () => log.timeout++,
  });
  const rng = mulberry32(seed);
  for (let i = 0; i < audio.length; ) {
    const n = 128 + Math.floor(rng() * (4096 - 128 + 1));
    rx.push(audio.subarray(i, i + n));
    i += n;
  }
  return { rx, rows, img, log };
}

function maePerChannel(a: Uint8ClampedArray, b: Uint8ClampedArray): number[] {
  const sum = [0, 0, 0];
  for (let p = 0; p < a.length; p += 4) for (let c = 0; c < 3; c++) sum[c] += Math.abs(a[p + c] - b[p + c]);
  return sum.map((s) => s / (a.length / 4));
}

const ALL_ROWS = Array.from({ length: ROBOT36.height }, (_, i) => i);

// ---------------------------------------------------------------- tests

describe('robot36', () => {
  it('lasts 240 × 150 ms plus a 910 ms VIS header', () => {
    expect(robot36DurationMs()).toBeCloseTo(36910, 6);
    const tx = robot36Modulate(testImage(), 48000);
    expect(tx.length).toBe(Math.round(36.91 * 48000));
    let peak = 0;
    for (let i = 0; i < tx.length; i++) peak = Math.max(peak, Math.abs(tx[i]));
    expect(peak).toBeLessThanOrEqual(0.8 + 1e-6);
    expect(Math.abs(tx[0])).toBeLessThan(1e-3); // fade-in
  });

  it('rejects images that are not 320×240', () => {
    expect(() => robot36Modulate(new ImageData(240, 320), 48000)).toThrow();
  });

  it('decodes through silence, ×0.3 level, 15 dB noise, 48→44.1 kHz and random chunks', () => {
    const src = testImage();
    const audio = impair(robot36Modulate(src, 48000), { rate: 48000, toRate: 44100, snrDb: 15, gain: 0.3, seed: 1 });
    const { rx, rows, img, log } = decode(audio, 44100, 2);
    expect(log.start).toBe(1);
    expect(rx.visCode).toBe(ROBOT36.visCode);
    expect(rows).toEqual(ALL_ROWS);
    expect(log.alphaOk).toBe(true);
    expect(log.progress).toBe(1);
    expect(log.done).toBe(1);
    expect(log.timeout).toBe(0);
    expect(rx.state).toBe('done');
    for (const e of maePerChannel(img, src.data)) expect(e).toBeLessThan(16);
  });

  it('follows a 200 ppm transmitter clock drift', () => {
    const src = testImage();
    const audio = impair(robot36Modulate(src, 48000), {
      rate: 48000,
      toRate: 44100,
      snrDb: 15,
      gain: 0.3,
      seed: 3,
      ppm: 200,
    });
    const { rx, rows, img } = decode(audio, 44100, 4);
    expect(rx.state).toBe('done');
    expect(rows).toEqual(ALL_ROWS);
    for (const e of maePerChannel(img, src.data)) expect(e).toBeLessThan(24);
  });

  it('re-locks after a dropped audio buffer longer than half a line', () => {
    const src = testImage();
    const sr = 44100;
    const full = impair(robot36Modulate(src, 48000), { rate: 48000, toRate: sr, snrDb: 15, gain: 0.3, seed: 7 });
    const at = 15 * sr;
    const drop = 4096; // 93 ms
    const audio = new Float32Array(full.length - drop);
    audio.set(full.subarray(0, at));
    audio.set(full.subarray(at + drop), at);
    const { rx, rows, img } = decode(audio, sr, 8);
    expect(rx.state).toBe('done');
    expect(rows).toEqual(ALL_ROWS);
    for (const e of maePerChannel(img, src.data)) expect(e).toBeLessThan(16);
  });

  it('does not mistake noise followed by an FSK lead-in for a VIS header', () => {
    const sr = 48000;
    const rng = mulberry32(9);
    const audio = new Float32Array(4 * sr);
    let ph = 0;
    let i = sr; // 1 s of noise only
    const tone = (f: number, ms: number) => {
      for (const end = i + (ms * sr) / 1000; i < end; i++) {
        audio[i] = 0.3 * Math.sin(ph);
        ph += (2 * Math.PI * f) / sr;
      }
    };
    tone(1200, 300); // FSK lead-in (mark)
    for (let b = 0; b < 200; b++) tone(rng() < 0.5 ? 1200 : 2200, 10);
    for (let k = 0; k < audio.length; k++) audio[k] += 0.04 * gaussian(rng);
    let starts = 0;
    const rx = new Robot36Receiver(sr, { onStart: () => starts++ }, { visTimeoutMs: 60000 });
    rx.push(audio);
    expect(starts).toBe(0);
    expect(rx.state).toBe('waiting-vis');
  });

  it('times out on silence after visTimeoutMs (default 8000)', () => {
    const sr = 48000;
    let timeouts = 0;
    let starts = 0;
    const rx = new Robot36Receiver(sr, { onTimeout: () => timeouts++, onStart: () => starts++ });
    const rng = mulberry32(5);
    const noise = new Float32Array(sr / 10); // 100 ms of faint noise
    for (let i = 0; i < 79; i++) {
      for (let k = 0; k < noise.length; k++) noise[k] = 0.01 * gaussian(rng);
      rx.push(noise);
    }
    expect(rx.state).toBe('waiting-vis'); // 7.9 s
    rx.push(noise);
    rx.push(noise);
    expect(rx.state).toBe('timeout');
    expect(timeouts).toBe(1);
    expect(starts).toBe(0);
    rx.push(noise);
    expect(timeouts).toBe(1);

    const quiet = new Robot36Receiver(sr, { onTimeout: () => timeouts++ }, { visTimeoutMs: 1000 });
    quiet.push(new Float32Array(sr * 1.2)); // digital silence
    expect(quiet.state).toBe('timeout');
    expect(timeouts).toBe(2);
  });

  it('stops emitting rows after abort()', () => {
    const audio = impair(robot36Modulate(testImage(), 48000), { rate: 48000, toRate: 48000, snrDb: 30, gain: 1, seed: 6 });
    const rows: number[] = [];
    const rx = new Robot36Receiver(48000, {
      onRow: (i) => {
        rows.push(i);
        if (i === 9) rx.abort();
      },
    });
    rx.push(audio);
    expect(rx.state).toBe('aborted');
    expect(rows).toEqual(ALL_ROWS.slice(0, 10));
  });
});
