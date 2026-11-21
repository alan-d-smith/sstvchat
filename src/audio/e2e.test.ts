// @vitest-environment node
//
// Two (or three) devices on one "air": real packet/FSK/Robot36 modems inside real audio
// transports, fake engines. Whatever a device plays is heard by every other device after a
// sample-rate change (48 kHz sender → 44.1 kHz receiver and back), a gain drop and white noise,
// delivered in mic-sized chunks. Time is compressed: playback is handed to the receivers at once.
import { describe, expect, it } from 'vitest';
import { createAudioTransport } from './audioTransport';
import type { AudioTransport } from './audioTransport';
import type { AudioEngine } from './engine';
import { resampleLinear } from './dsp';
import { robot36DurationMs } from './robot36';
import { paintRow } from '../sim/rotate';
import { createMockTransport } from '../sim/transport';
import type { Transport, TransportEvents } from '../sim/transport';

const EVENTS: (keyof TransportEvents)[] = [
  'tx:queued', 'tx:start', 'tx:progress', 'tx:done', 'tx:cancelled',
  'rx:start', 'rx:row', 'rx:text-chunk', 'rx:progress', 'rx:done', 'rx:cancelled',
];

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
const gaussian = (rand: () => number) =>
  Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());

interface Device {
  id: string;
  rate: number;
  chunk: number;
  transport: Transport;
  log: [string, ...unknown[]][];
  hear(samples: Float32Array): void;
  events(name: keyof TransportEvents): [string, ...unknown[]][];
}

interface Play { from: Device; samples: Float32Array; onProgress?: (p: number) => void; resolve(): void }

const GAIN = 0.3;
const NOISE = 0.01; // ≈ 24 dB below the received tone
const PAD_MS = 400; // room noise before and after each transmission

/** One shared room. `leak`: a device also hears its own transmission (no mic mute). */
/** `garble`: damages what is played before the room hears it (e.g. a burst of noise over one part). */
function air(opts: { leak?: boolean; seed?: number; garble?: (samples: Float32Array) => Float32Array } = {}) {
  const devices: Device[] = [];
  const queue: Play[] = [];
  const rand = mulberry32(opts.seed ?? 7);
  /** Chat "bob" addresses "bob"; "grp" addresses everyone (a careless roster that includes the sender). */
  const roster = (ids: string[]) => ids.flatMap((c) => (c === 'grp' ? ['alice', 'bob', 'carol'] : [c]));

  function device(id: string, rate: number, chunk = 2048): Device {
    const listeners = new Set<(c: Float32Array) => void>();
    let self: Device;
    const engine: AudioEngine = {
      sampleRate: rate,
      state: () => 'listening',
      start: async () => {},
      onState: () => () => {},
      onSamples(fn) {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
      play(samples, onProgress) {
        let resolve!: () => void;
        const done = new Promise<void>((r) => {
          resolve = r;
        });
        queue.push({ from: self, samples, onProgress, resolve });
        return { done, stop: resolve };
      },
    };
    const transport = createAudioTransport({
      engine,
      self: () => ({ id, name: id }),
      recipients: roster,
      fallback: createMockTransport(),
    });
    const log: [string, ...unknown[]][] = [];
    for (const ev of EVENTS) transport.on(ev, ((...a: unknown[]) => log.push([ev, ...a])) as never);
    self = {
      id, rate, chunk, transport, log,
      hear(samples) {
        for (let i = 0; i < samples.length; i += chunk) {
          const c = samples.slice(i, i + chunk);
          for (const fn of [...listeners]) fn(c);
        }
      },
      events: (name) => log.filter((e) => e[0] === name),
    };
    devices.push(self);
    return self;
  }

  /** What `to` hears of `samples` played at `fromRate`: padded, attenuated, noisy, resampled. */
  function channel(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
    const pad = Math.round((fromRate * PAD_MS) / 1000);
    const x = new Float32Array(pad + samples.length + pad);
    for (let i = 0; i < samples.length; i++) x[pad + i] = GAIN * samples[i];
    for (let i = 0; i < x.length; i++) x[i] += NOISE * gaussian(rand);
    return resampleLinear(x, fromRate, toRate);
  }

  /** Plays everything queued (and whatever that triggers) to the room; returns what was played. */
  async function run(): Promise<Play[]> {
    const played: Play[] = [];
    for (let guard = 0; queue.length > 0 && guard < 20; guard++) {
      const p = queue.shift()!;
      played.push(p);
      for (const d of devices) {
        if (d === p.from && !opts.leak) continue;
        d.hear(channel(opts.garble ? opts.garble(p.samples) : p.samples, p.from.rate, d.rate));
      }
      p.onProgress?.(1);
      p.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
    return played;
  }

  /** Plays raw samples recorded earlier from `from` again (a looped recording / echo of the same transmission). */
  function replay(p: Play) {
    for (const d of devices) if (d !== p.from) d.hear(channel(p.samples, p.from.rate, d.rate));
  }

  return { device, run, replay };
}

const names = (d: Device) => d.log.filter((e) => e[0] !== 'rx:row' && e[0] !== 'rx:progress' && e[0] !== 'tx:progress').map((e) => e[0]);
const rxOnly = (d: Device) => d.log.filter((e) => e[0].startsWith('rx:'));

/** Portrait 240×320 test snap: four flat horizontal bands (they become vertical bands on air). */
function testSnap(): ImageData {
  const img = new ImageData(240, 320);
  const bands: [number, number, number][] = [[220, 40, 40], [40, 180, 70], [40, 80, 220], [240, 230, 60]];
  for (let y = 0; y < 320; y++) {
    const [r, g, b] = bands[Math.floor(y / 80)];
    for (let x = 0; x < 240; x++) img.data.set([r, g, b, 255], (y * 240 + x) * 4);
  }
  return img;
}

/** Mean absolute error per channel between two portrait images, skipping a margin around band edges. */
function bandError(a: ImageData, b: ImageData): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < 320; y++) {
    if (Math.abs((y % 80) - 40) > 32) continue; // within 8 px of a band edge
    for (let x = 4; x < 236; x++) {
      const i = (y * 240 + x) * 4;
      for (let c = 0; c < 3; c++) sum += Math.abs(a.data[i + c] - b.data[i + c]);
      n += 3;
    }
  }
  return sum / n;
}

describe('two devices over the air (real modems)', () => {
  it('delivers a text from alice to bob only, and alice sees it sent', async () => {
    const room = air({ seed: 1 });
    const alice = room.device('alice', 48000);
    const bob = room.device('bob', 44100);
    const carol = room.device('carol', 44100, 4096);

    const h = alice.transport.sendText('bob', 'hi bob 👋 over the air');
    await room.run();

    expect(names(alice)).toEqual(['tx:start', 'tx:done']);
    expect(alice.events('tx:start')[0][1]).toBe(h);
    expect(names(bob)[0]).toBe('rx:start');
    expect(names(bob).at(-1)).toBe('rx:done');
    const [, rh, from, kind, mode, meta] = bob.events('rx:start')[0];
    expect([from, kind, mode]).toEqual(['alice', 'text', 'two-tone']);
    expect(meta).toMatchObject({ chatId: 'bob' });
    expect(bob.events('rx:text-chunk').at(-1)).toEqual(['rx:text-chunk', rh, 'hi bob 👋 over the air']);
    expect(rxOnly(carol)).toEqual([]);
  });

  it('delivers a snap (FSK header + Robot36) from alice to bob as 240 rows, nothing to carol', async () => {
    const room = air({ seed: 2 });
    const alice = room.device('alice', 48000);
    const bob = room.device('bob', 44100);
    const carol = room.device('carol', 44100, 4096);

    const sent = testSnap();
    alice.transport.sendSnap(['bob'], sent);
    await room.run();

    expect(names(alice)).toEqual(['tx:start', 'tx:done']);
    expect(names(bob)).toEqual(['rx:start', 'rx:done']);
    const [, rh, from, kind, mode, meta] = bob.events('rx:start')[0];
    expect([from, kind, mode]).toEqual(['alice', 'snap', 'Robot36']);
    expect(meta).toMatchObject({ chatId: 'bob' });
    const rows = bob.events('rx:row');
    expect(rows).toHaveLength(240);
    expect(rows.every((r) => r[1] === rh)).toBe(true);
    expect(new Set(rows.map((r) => r[2])).size).toBe(240);
    expect(bob.events('rx:progress').at(-1)).toEqual(['rx:progress', rh, 1]);

    const got = new ImageData(240, 320);
    for (const [, , i, row] of rows) paintRow(got, i as number, row as Uint8ClampedArray);
    expect(bandError(got, sent)).toBeLessThan(16);

    expect(rxOnly(carol)).toEqual([]);
  });

  it('still receives a snap whose first header copy is drowned out (the second copy starts the image)', async () => {
    // The header goes out twice: [copy, 150 ms, copy, 300 ms, Robot36]. Bury most of the first copy.
    const garble = (x: Float32Array) => {
      const image = Math.round((robot36DurationMs() * 48000) / 1000);
      const copy = (x.length - image - Math.round(48000 * 0.45)) / 2;
      const y = x.slice();
      const rand = mulberry32(99);
      for (let i = Math.round(copy * 0.2); i < copy; i++) y[i] = 0.9 * (2 * rand() - 1);
      return y;
    };
    const room = air({ seed: 6, garble });
    const alice = room.device('alice', 48000);
    const bob = room.device('bob', 44100);
    const sent = testSnap();
    alice.transport.sendSnap(['bob'], sent);
    await room.run();

    expect(names(bob)).toEqual(['rx:start', 'rx:done']);
    const { diag } = bob.transport as AudioTransport;
    // Both copies were framed; the first was lost (abort / bad CRC), the second accepted.
    expect(diag.stats()).toMatchObject({ frames: 2, crcOk: 1, sstvDone: 1 });
    expect(diag.stats().aborts + diag.stats().crcFail).toBeGreaterThanOrEqual(1);
    expect(diag.log().map((e) => e.decision)).toEqual(['accepted → SSTV', 'SSTV: VIS found, receiving', 'SSTV: done (240 lines)']);
    const rows = bob.events('rx:row');
    expect(rows).toHaveLength(240);
    const got = new ImageData(240, 320);
    for (const [, , i, row] of rows) paintRow(got, i as number, row as Uint8ClampedArray);
    expect(bandError(got, sent)).toBeLessThan(16);
  });

  it('ignores its own transmissions even when they leak into its mic', async () => {
    const room = air({ leak: true, seed: 3 });
    const alice = room.device('alice', 48000);
    const bob = room.device('bob', 44100);
    const carol = room.device('carol', 48000);

    bob.transport.sendText('grp', 'reply from bob'); // addressed to alice, bob and carol
    await room.run();

    expect(rxOnly(bob)).toEqual([]);
    expect(names(bob)).toEqual(['tx:start', 'tx:done']);
    expect(alice.events('rx:text-chunk').at(-1)?.[2]).toBe('reply from bob');
    expect(carol.events('rx:text-chunk').at(-1)?.[2]).toBe('reply from bob');
  });

  it('receives a repeated recording of the same text once, but two sends of the same words twice', async () => {
    const room = air({ seed: 4 });
    const alice = room.device('alice', 48000);
    const bob = room.device('bob', 44100);

    alice.transport.sendText('bob', 'ok');
    const [first] = await room.run();
    room.replay(first); // e.g. a looped recording of that transmission
    expect(bob.events('rx:done')).toHaveLength(1);

    alice.transport.sendText('bob', 'ok');
    await room.run();
    expect(bob.events('rx:start')).toHaveLength(2);
    expect(bob.events('rx:done')).toHaveLength(2);
    const [h1, h2] = bob.events('rx:done').map((e) => e[1]);
    for (const h of [h1, h2]) expect(bob.events('rx:text-chunk').filter((e) => e[1] === h).at(-1)?.[2]).toBe('ok');
  });

  it('records a repeated snap transmission only once', async () => {
    const room = air({ seed: 5 });
    const alice = room.device('alice', 48000);
    const bob = room.device('bob', 44100);

    alice.transport.sendSnap(['bob'], testSnap());
    const [first] = await room.run();
    expect(bob.events('rx:done')).toHaveLength(1);
    room.replay(first);
    expect(bob.events('rx:start')).toHaveLength(1);
    expect(bob.events('rx:row')).toHaveLength(240);
  });
});
