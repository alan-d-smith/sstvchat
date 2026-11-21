// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createInputMeter, createRadioDiag, encodeWav16, LOG_SIZE, measure } from './diagnostics';
import type { AudioEngine } from './engine';

const RATE = 48000;
const sine = (freq: number, amp: number, n = RATE / 5) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / RATE));

function engineWithMic() {
  const fns = new Set<(c: Float32Array) => void>();
  const engine: AudioEngine = {
    sampleRate: RATE,
    state: () => 'listening',
    start: async () => {},
    onState: () => () => {},
    onSamples(fn) {
      fns.add(fn);
      return () => {
        fns.delete(fn);
      };
    },
    play: () => ({ done: Promise.resolve(), stop() {} }),
  };
  const hear = (x: Float32Array, chunk = 2048) => {
    for (let i = 0; i < x.length; i += chunk) for (const fn of [...fns]) fn(x.subarray(i, i + chunk));
  };
  return { engine, hear, listeners: () => fns.size };
}

describe('measure', () => {
  it('reads the level of each FSK tone and a low floor for a clean mark tone', () => {
    const m = measure(sine(1200, 0.5), RATE);
    expect(m.markDb).toBeCloseTo(-6.02, 0);
    expect(m.spaceDb).toBeLessThan(-50);
    expect(m.floorDb).toBeLessThan(-50);
    expect(m.peakDb).toBeCloseTo(-6.02, 0);
    expect(m.rmsDb).toBeCloseTo(-9.03, 0);
    const s = measure(sine(2200, 0.1), RATE);
    expect(s.spaceDb).toBeCloseTo(-20, 0);
    expect(s.markDb).toBeLessThan(-60);
  });
});

describe('input meter', () => {
  it('measures the same chunks the receiver gets and records them raw', async () => {
    const { engine, hear, listeners } = engineWithMic();
    const meter = createInputMeter(engine);
    hear(sine(1200, 0.25, RATE));
    const l = meter.levels();
    expect(l.markDb).toBeCloseTo(-12, 0);
    expect(l.seconds).toBeCloseTo(1, 2);
    expect(l.chunks).toBe(Math.ceil(RATE / 2048));

    const rec = meter.record(100);
    const sig = sine(2200, 0.3, RATE / 5);
    hear(sig);
    const { samples, sampleRate } = await rec;
    expect(sampleRate).toBe(RATE);
    expect(samples).toEqual(sig.slice(0, RATE / 10));
    meter.dispose();
    expect(listeners()).toBe(0);
  });
});

describe('encodeWav16', () => {
  it('writes a 16-bit mono PCM WAV', () => {
    const bytes = encodeWav16(Float32Array.of(0, 0.5, -1, 2), 44100);
    const v = new DataView(bytes.buffer);
    const s = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
    expect([s(0, 4), s(8, 4), s(12, 4), s(36, 4)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([1, 1, 44100, 16]);
    expect(v.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + 2 * i, true))).toEqual([0, 16384, -32767, 32767]);
  });
});

describe('radio diag', () => {
  it('counts and keeps the last entries', () => {
    const d = createRadioDiag();
    d.count('frames');
    d.count('bytes', 12);
    for (let i = 0; i < LOG_SIZE + 3; i++) d.add({ kind: 'text', from: 'a', to: ['b'], id: String(i), decision: 'accepted' });
    expect(d.stats()).toMatchObject({ frames: 1, bytes: 12, crcOk: 0 });
    expect(d.log().map((e) => e.id)).toEqual(Array.from({ length: LOG_SIZE }, (_, i) => String(i + 3)));
  });
});
