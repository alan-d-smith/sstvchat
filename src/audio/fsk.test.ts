// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { encodePacket, type Packet } from './packet';
import { FSK, fskDurationMs, fskModulate, FskReceiver } from './fsk';
import { resampleLinear } from './dsp';

// ---- deterministic test signals ----

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

function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
}

function rms(x: Float32Array): number {
  let e = 0;
  for (let i = 0; i < x.length; i++) e += x[i] * x[i];
  return Math.sqrt(e / x.length);
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Leading silence, gain, white noise at `snrDb` relative to the (scaled) signal, resampling. */
function impair(
  sig: Float32Array,
  opts: { seed: number; silenceMs?: number; trailMs?: number; gain?: number; snrDb?: number; fromRate?: number; toRate?: number },
): Float32Array {
  const { seed, silenceMs = 500, trailMs = 200, gain = 0.3, snrDb = 15, fromRate = 48000, toRate = 44100 } = opts;
  const lead = Math.round((fromRate * silenceMs) / 1000);
  const x = new Float32Array(lead + sig.length + Math.round((fromRate * trailMs) / 1000));
  for (let i = 0; i < sig.length; i++) x[lead + i] = sig[i] * gain;
  const sigma = (rms(sig) * gain) / Math.pow(10, snrDb / 20);
  const rand = mulberry32(seed);
  for (let i = 0; i < x.length; i++) x[i] += sigma * gaussian(rand);
  return resampleLinear(x, fromRate, toRate);
}

/** Room-ish channel: early reflection + exponentially decaying diffuse tail at `drDb` direct-to-reverb. */
function reverb(sig: Float32Array, rate: number, seed: number, rt60 = 0.3, drDb = 8, early = 0.4): Float32Array {
  const rand = mulberry32(seed);
  const len = Math.round(rate * rt60);
  const taps: [number, number][] = [];
  let e = 0;
  for (let d = Math.round(rate * 0.003); d < len; d += Math.round(rate * 0.001)) {
    const g = gaussian(rand) * Math.pow(10, (-3 * d) / len);
    taps.push([d, g]);
    e += g * g;
  }
  const k = Math.sqrt(Math.pow(10, -drDb / 10) / e);
  for (const t of taps) t[1] *= k;
  taps.push([Math.round(rate * 0.0013), early]);
  const y = new Float32Array(sig.length + len);
  for (let i = 0; i < sig.length; i++) {
    const v = sig[i];
    y[i] += v;
    for (const [d, g] of taps) y[i + d] += g * v;
  }
  return y;
}

/** First-difference tilt (a small speaker's rising response): lifts space over mark by a few dB per stage. */
function tilt(sig: Float32Array, stages: number): Float32Array {
  let x = sig;
  for (let s = 0; s < stages; s++) {
    const y = new Float32Array(x.length);
    for (let i = 1; i < x.length; i++) y[i] = 3 * (x[i] - 0.9 * x[i - 1]);
    x = y;
  }
  return x;
}

interface Rx {
  rx: FskReceiver;
  packets: { p: Packet; ok: boolean }[];
  log: string[];
  aborts: number;
}

function receiver(rate: number): Rx {
  const r: Rx = { rx: undefined as unknown as FskReceiver, packets: [], log: [], aborts: 0 };
  r.rx = new FskReceiver(rate, {
    onFrameStart: () => r.log.push('start'),
    onHeader: () => r.log.push('header'),
    onTextChunk: () => r.log.push('text'),
    onPacket: (p, ok) => {
      r.log.push('packet');
      r.packets.push({ p, ok });
    },
    onAbort: () => {
      r.log.push('abort');
      r.aborts++;
    },
  });
  return r;
}

/** Feeds `x` in random chunk sizes in [min, max]. */
function feed(r: Rx, x: Float32Array, seed: number, min = 128, max = 4096): void {
  const rand = mulberry32(seed);
  for (let i = 0; i < x.length; ) {
    const n = min + Math.floor(rand() * (max - min + 1));
    r.rx.push(x.subarray(i, i + n));
    i += n;
  }
}

const packet: Packet = {
  kind: 'text',
  from: 'alice',
  fromName: 'Alice 🙂',
  to: ['bob', 'carol'],
  chatId: 'chat-alice-bob',
  mode: '',
  text: 'Hello over the air! 📻 Two tones, one message.',
};

const snap: Packet = { kind: 'snap', from: 'bob', fromName: 'Bob', to: ['alice'], chatId: 'chat-alice-bob', mode: 'Robot36', text: '' };

// ---- tests ----

describe('fskModulate', () => {
  it('matches fskDurationMs at common rates', () => {
    const bytes = encodePacket(packet);
    expect(fskDurationMs(bytes.length)).toBe(FSK.leadInMs + bytes.length * 100 + FSK.tailMs);
    for (const rate of [44100, 48000]) {
      const sig = fskModulate(bytes, rate);
      expect(Math.abs((sig.length / rate) * 1000 - fskDurationMs(bytes.length))).toBeLessThan(1);
    }
  });

  it('respects the amplitude and fades in and out', () => {
    const sig = fskModulate(encodePacket(snap), 48000);
    let peak = 0;
    for (const v of sig) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(FSK.amplitude + 1e-6);
    expect(peak).toBeGreaterThan(FSK.amplitude - 0.01);
    expect(Math.abs(sig[0])).toBeLessThan(1e-6);
    expect(Math.abs(sig[sig.length - 1])).toBeLessThan(0.01);
    const quiet = fskModulate(encodePacket(snap), 48000, 0.25);
    expect(Math.max(...quiet.subarray(48000 * 0.1, 48000 * 0.2))).toBeLessThanOrEqual(0.25 + 1e-6);
  });
});

describe('FskReceiver', () => {
  it('decodes a packet through silence, attenuation, 15 dB noise and 48k→44.1k resampling in random chunks', () => {
    const x = impair(fskModulate(encodePacket(packet), 48000), { seed: 1 });
    const r = receiver(44100);
    let busySeen = false;
    const rand = mulberry32(2);
    for (let i = 0; i < x.length; ) {
      const n = 128 + Math.floor(rand() * 3969);
      r.rx.push(x.subarray(i, i + n));
      busySeen ||= r.rx.busy;
      i += n;
    }
    expect(r.packets).toEqual([{ p: packet, ok: true }]);
    expect(r.log[0]).toBe('start');
    expect(r.log[1]).toBe('header');
    expect(r.log.filter((e) => e === 'text').length).toBeGreaterThan(10);
    expect(r.log[r.log.length - 1]).toBe('packet');
    expect(r.aborts).toBe(0);
    expect(busySeen).toBe(true);
    expect(r.rx.busy).toBe(false);
  });

  it('decodes two packets sent back to back', () => {
    const sig = concat(fskModulate(encodePacket(snap), 48000), fskModulate(encodePacket(packet), 48000));
    const r = receiver(44100);
    feed(r, impair(sig, { seed: 3 }), 4);
    expect(r.packets).toEqual([
      { p: snap, ok: true },
      { p: packet, ok: true },
    ]);
  });

  it('decodes with one-sample and whole-signal pushes alike', () => {
    const x = impair(fskModulate(encodePacket(snap), 48000), { seed: 5, toRate: 48000 });
    const a = receiver(48000);
    for (let i = 0; i < x.length; i++) a.rx.push(x.subarray(i, i + 1));
    const b = receiver(48000);
    b.rx.push(x);
    expect(a.packets).toEqual([{ p: snap, ok: true }]);
    expect(b.packets).toEqual(a.packets);
  });

  it('survives a room-like channel: echo, speaker tilt, clock drift', () => {
    const room = tilt(reverb(fskModulate(encodePacket(snap), 48000), 48000, 7), 2);
    const x = impair(room, { seed: 8, gain: 0.05, snrDb: 20, toRate: 44100 * 1.001 });
    const r = receiver(44100);
    feed(r, x, 9);
    expect(r.packets).toEqual([{ p: snap, ok: true }]);
  });

  it('yields nothing from 5 s of pure noise', () => {
    const rand = mulberry32(11);
    const x = new Float32Array(48000 * 5);
    for (let i = 0; i < x.length; i++) x[i] = 0.2 * gaussian(rand);
    const r = receiver(48000);
    expect(() => feed(r, x, 12)).not.toThrow();
    expect(r.log).toEqual([]);
    expect(r.rx.bytesDecoded).toBe(0);
    expect(r.rx.busy).toBe(false);
  });

  it('ignores digital silence', () => {
    const r = receiver(44100);
    r.rx.push(new Float32Array(44100 * 2));
    expect(r.log).toEqual([]);
    expect(r.rx.bytesDecoded).toBe(0);
  });

  it('aborts a frame whose transmission stops midway', () => {
    const sig = fskModulate(encodePacket(packet), 48000);
    const cut = sig.subarray(0, Math.round(48000 * (0.3 + 0.1 * 60))); // lead-in + 60 bytes (past the header)
    const r = receiver(44100);
    feed(r, impair(concat(cut, new Float32Array(48000)), { seed: 13 }), 14);
    expect(r.log).toContain('header');
    expect(r.packets).toEqual([]);
    expect(r.aborts).toBe(1);
    expect(r.rx.busy).toBe(false);
  });

  it('reset() drops a frame in progress without events', () => {
    const sig = fskModulate(encodePacket(packet), 48000);
    const r = receiver(48000);
    r.rx.push(sig.subarray(0, Math.round(48000 * (0.3 + 0.1 * 12))));
    expect(r.rx.busy).toBe(true);
    const before = r.log.length;
    r.rx.reset();
    expect(r.rx.busy).toBe(false);
    r.rx.push(fskModulate(encodePacket(snap), 48000));
    expect(r.log.slice(before).filter((e) => e === 'abort')).toEqual([]);
    expect(r.packets).toEqual([{ p: snap, ok: true }]);
  });
});
