// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createInputMeter, createRadioDiag, createToneWatch, encodeWav16, LOG_SIZE, measure } from './diagnostics';
import type { AudioEngine } from './engine';
import { createAudioTransport } from './audioTransport';
import { encodePacket } from './packet';
import { FSK, fskModulate } from './fsk';
import { robot36Modulate } from './robot36';
import { createMockTransport } from '../sim/transport';
import { rotateCW } from '../sim/rotate';

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

describe('undecoded-tone watch', () => {
  /** Half a second of quiet room either side, the signal at 0.3, light noise. */
  const room = (x: Float32Array, seed = 1) => {
    let a = seed;
    const lead = RATE / 2;
    const out = new Float32Array(x.length + RATE);
    for (let i = 0; i < out.length; i++) {
      a = (a * 1103515245 + 12345) >>> 0;
      const s = i >= lead && i - lead < x.length ? 0.3 * x[i - lead] : 0;
      out[i] = s + 0.003 * ((a / 2 ** 32) * 2 - 1);
    }
    return out;
  };
  /** Random bits on the real mark/space tones at `baud` (continuous phase). */
  const twoTone = (baud: number, seconds: number) => {
    const out = new Float32Array(RATE * seconds);
    let phase = 0;
    let bit = 1;
    let a = 7;
    for (let i = 0; i < out.length; i++) {
      if (i % Math.round(RATE / baud) === 0) {
        a = (a * 1103515245 + 12345) >>> 0;
        bit = a >>> 31;
      }
      phase += (2 * Math.PI * (bit ? FSK.mark : FSK.space)) / RATE;
      out[i] = 0.8 * Math.sin(phase);
    }
    return out;
  };
  const packet = encodePacket({ kind: 'text', from: 'alice', fromName: '', to: ['bob'], chatId: 'bob', mode: '', id: 'ab12', text: 'hello bob, are you there?' });

  function watch() {
    const mic = engineWithMic();
    const t = createAudioTransport({ engine: mic.engine, self: () => ({ id: 'bob', name: 'bob' }), recipients: (c) => c, fallback: createMockTransport() });
    const hits: number[] = [];
    createToneWatch(mic.engine, t.diag, () => hits.push(t.diag.stats().frames));
    return { ...mic, t, hits };
  }

  it('stays quiet when the receiver frames the tones', () => {
    const w = watch();
    w.hear(room(fskModulate(packet, RATE)));
    expect(w.t.diag.stats().crcOk).toBe(1);
    expect(w.hits).toEqual([]);
  });

  it('fires once per stretch of clear two-tone audio that yields no frame', () => {
    const w = watch();
    w.hear(room(twoTone(300, 4))); // plainly the two tones, but nothing the receiver can frame
    expect(w.t.diag.stats().frames).toBe(0);
    expect(w.hits).toEqual([0]);
    w.hear(room(twoTone(300, 1))); // too short to judge
    expect(w.hits).toEqual([0]);
  });

  it('stands down while an SSTV image is being received (no FSK is decoded then)', () => {
    const w = watch();
    const header = encodePacket({ kind: 'snap', from: 'alice', fromName: '', to: ['bob'], chatId: 'bob', mode: 'Robot36', id: 'sn01', text: '' });
    const head = fskModulate(header, RATE);
    const audio = new Float32Array(head.length + RATE * 3.15);
    audio.set(head);
    // A pause, then undecodable tones where the image should be (all within the VIS timeout).
    audio.set(twoTone(100, 2.6), head.length + RATE * 0.55); // random bits: no UART frame
    w.hear(room(audio));
    expect(w.t.diag.stats()).toMatchObject({ crcOk: 1, visTimeouts: 0 });
    expect(w.hits).toEqual([]);
    w.hear(room(twoTone(300, 4))); // past the VIS timeout the FSK receiver listens again
    expect(w.t.diag.stats().visTimeouts).toBe(1);
    expect(w.hits).toEqual([1]);
  });

  it('does not judge the image airtime after anyone’s snap header', () => {
    const w = watch();
    const header = fskModulate(encodePacket({ kind: 'snap', from: 'alice', fromName: '', to: ['carol'], chatId: 'carol', mode: 'Robot36', id: 'sn03', text: '' }), RATE);
    const audio = new Float32Array(header.length + RATE * 3.6);
    audio.set(header);
    audio.set(twoTone(100, 3), header.length + RATE * 0.6); // whatever the image period sounds like
    w.hear(room(audio));
    expect(w.t.diag.stats()).toMatchObject({ snapHeaders: 1, frames: 1 });
    expect(w.hits).toEqual([]);
    w.hear(new Float32Array(RATE * 40)); // the image airtime is over
    w.hear(room(twoTone(100, 3)));
    expect(w.hits).toEqual([1]);
  });

  it('stays quiet through someone else’s snap, even with dropped audio', () => {
    const w = watch();
    // The browser test's snap: colour bands, a white diagonal, a checkerboard.
    const portrait = new ImageData(240, 320);
    const bands = [[230, 40, 40], [40, 190, 80], [40, 90, 230], [245, 225, 50]];
    for (let y = 0; y < 320; y++) {
      for (let x = 0; x < 240; x++) {
        let c = bands[Math.min(3, Math.floor(y / 64))];
        if (y >= 256) c = ((x >> 4) + (y >> 4)) & 1 ? [255, 255, 255] : [0, 0, 0];
        if (Math.abs(x - (y * 240) / 320) < 3) c = [255, 255, 255];
        portrait.data.set([c[0], c[1], c[2], 255], (y * 240 + x) * 4);
      }
    }
    const header = fskModulate(encodePacket({ kind: 'snap', from: 'alice', fromName: '', to: ['carol'], chatId: 'carol', mode: 'Robot36', id: 'sn02', text: '' }), RATE);
    // The image as a starved capture delivers it: 10 ms lost every 60 ms.
    const image = robot36Modulate(rotateCW(portrait), RATE).filter((_, i) => i % 2880 < 2400);
    const audio = new Float32Array(header.length + RATE * 0.3 + image.length);
    audio.set(header);
    audio.set(image, header.length + RATE * 0.3);
    w.hear(room(audio));
    expect(w.t.diag.stats()).toMatchObject({ snapHeaders: 1, sstvStarted: 0 });
    expect(w.hits).toEqual([]);
  });

  it('ignores SSTV images, speech-like sound and silence', () => {
    const w = watch();
    const img = new ImageData(320, 240);
    for (let i = 0; i < img.data.length; i += 4) {
      const x = (i / 4) % 320;
      img.data.set([x * 0.8, 128, 200 - x / 2, 255], i);
    }
    const gray = new ImageData(320, 240);
    gray.data.fill(128);
    const white = new ImageData(320, 240);
    white.data.fill(255);
    const light = new ImageData(320, 240); // luma ≈ 2197 Hz: right on the space tone
    light.data.fill(240);
    for (const im of [img, gray, white, light]) w.hear(room(robot36Modulate(im, RATE).subarray(0, RATE * 8)));
    const voice = Float32Array.from({ length: RATE * 3 }, (_, i) => 0.4 * Math.sin(i * 0.037 + 3 * Math.sin(i * 0.0007)) * Math.abs(Math.sin(i * 0.0004)));
    w.hear(room(voice));
    w.hear(room(sine(FSK.mark, 0.8, RATE * 3))); // a steady test tone is not FSK
    w.hear(new Float32Array(RATE * 2));
    expect(w.hits).toEqual([]);
  });
});
