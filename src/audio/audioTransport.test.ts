import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioTransport } from './audioTransport';
import type { AudioEngine } from './engine';
import { encodePacket } from './packet';
import type { Packet } from './packet';
import { fskModulate } from './fsk';
import { robot36Modulate } from './robot36';
import { createMockTransport } from '../sim/transport';
import type { TransportEvents } from '../sim/transport';

/*
 * Stand-in modems with a trivially decodable "audio" format, so the transport's routing, queueing
 * and receiver switching can be tested without real DSP:
 *   FSK frame  = [FSK, byteCount, ...bytes]        (bytes = JSON of the packet)
 *   Robot36    = [R36, r, g, b, 1 × 240]           (one row per trailing sample)
 * Zeros are silence. A non-zero sample other than R36 while waiting for VIS is a timeout.
 */
const fake = vi.hoisted(() => {
  const FSK = 1000;
  const R36 = 2000;
  const state = { crcOk: true };
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  type FskEvents = {
    onFrameStart?(): void; onHeader?(h: unknown): void; onTextChunk?(t: string): void;
    onPacket?(p: unknown, ok: boolean): void; onAbort?(): void;
  };
  type R36Events = {
    onStart?(): void; onRow?(i: number, row: Uint8ClampedArray): void; onProgress?(p: number): void;
    onDone?(): void; onTimeout?(): void;
  };

  class FskReceiver {
    busy = false;
    private need = -1;
    private bytes: number[] = [];
    constructor(_rate: number, private events: FskEvents) {}
    push(samples: Float32Array) {
      for (const v of samples) this.step(v);
    }
    private step(v: number) {
      if (!this.busy) {
        if (v === FSK) {
          this.busy = true;
          this.need = -1;
          this.bytes = [];
          this.events.onFrameStart?.();
        }
        return;
      }
      if (this.need < 0) {
        this.need = v;
        return;
      }
      this.bytes.push(v);
      if (this.bytes.length < this.need) return;
      this.busy = false;
      const p = JSON.parse(dec.decode(Uint8Array.from(this.bytes)));
      const { text, ...header } = p;
      this.events.onHeader?.(header);
      for (let i = 1; i <= text.length; i++) this.events.onTextChunk?.(text.slice(0, i));
      this.events.onPacket?.(p, state.crcOk);
    }
    reset() {
      this.busy = false;
    }
  }

  class Robot36Receiver {
    state: 'waiting-vis' | 'receiving' | 'done' | 'timeout' | 'aborted' = 'waiting-vis';
    private px: number[] = [];
    private rows = 0;
    constructor(_rate: number, private events: R36Events, _opts?: unknown) {}
    push(samples: Float32Array) {
      for (const v of samples) {
        if (this.state === 'waiting-vis') {
          if (v === 0) continue;
          if (v !== R36) {
            this.state = 'timeout';
            this.events.onTimeout?.();
            return;
          }
          this.state = 'receiving';
          this.events.onStart?.();
        } else if (this.state === 'receiving') {
          if (this.px.length < 3) {
            this.px.push(v);
            continue;
          }
          if (v === 0) continue;
          const row = new Uint8ClampedArray(320 * 4);
          for (let x = 0; x < 320; x++) row.set([this.px[0], this.px[1], this.px[2], 255], x * 4);
          const i = this.rows++;
          this.events.onRow?.(i, row);
          this.events.onProgress?.(this.rows / 240);
          if (this.rows === 240) {
            this.state = 'done';
            this.events.onDone?.();
            return;
          }
        } else {
          return;
        }
      }
    }
    abort() {
      this.state = 'aborted';
    }
  }

  return {
    state,
    FskReceiver,
    Robot36Receiver,
    encodePacket: (p: unknown) => enc.encode(JSON.stringify(p)),
    fskModulate: (bytes: Uint8Array) => {
      const out = new Float32Array(bytes.length + 2);
      out[0] = FSK;
      out[1] = bytes.length;
      out.set(bytes, 2);
      return out;
    },
    robot36Modulate: (img: ImageData) => {
      const out = new Float32Array(4 + 240).fill(1);
      out.set([R36, img.data[0], img.data[1], img.data[2]]);
      return out;
    },
  };
});

vi.mock('./packet', () => ({ encodePacket: vi.fn(fake.encodePacket) }));
vi.mock('./fsk', () => ({ fskModulate: vi.fn(fake.fskModulate), FskReceiver: fake.FskReceiver }));
vi.mock('./robot36', () => ({ robot36Modulate: vi.fn(fake.robot36Modulate), Robot36Receiver: fake.Robot36Receiver }));

const RATE = 8000;
const EVENTS: (keyof TransportEvents)[] = [
  'tx:queued', 'tx:start', 'tx:progress', 'tx:done', 'tx:cancelled',
  'rx:start', 'rx:row', 'rx:text-chunk', 'rx:progress', 'rx:done', 'rx:cancelled',
];
/** Who each test chat addresses. */
const ROSTER: Record<string, string[]> = { c1: ['bob'], grp: ['bob', 'carol'] };

interface Play { samples: Float32Array; onProgress?: (p: number) => void; resolve(): void; stopped: boolean }

function fakeEngine() {
  const listeners = new Set<(c: Float32Array) => void>();
  const plays: Play[] = [];
  const engine: AudioEngine = {
    sampleRate: RATE,
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
      const p: Play = { samples, onProgress, resolve, stopped: false };
      plays.push(p);
      return {
        done,
        stop() {
          p.stopped = true;
          resolve();
        },
      };
    },
  };
  /** Mic input, in chunks like the capture worklet. */
  const hear = (samples: Float32Array, chunk = 512) => {
    for (let i = 0; i < samples.length; i += chunk) {
      for (const fn of [...listeners]) fn(samples.subarray(i, i + chunk));
    }
  };
  return { engine, plays, hear };
}

function radio(id: string, name: string) {
  const { engine, plays, hear } = fakeEngine();
  const fallback = createMockTransport({ snapMs: 100, textMs: 100 });
  const t = createAudioTransport({
    engine,
    self: () => ({ id, name }),
    recipients: (ids) => ids.flatMap((c) => ROSTER[c] ?? [c]),
    fallback,
  });
  const log: [string, ...unknown[]][] = [];
  for (const ev of EVENTS) t.on(ev, ((...a: unknown[]) => log.push([ev, ...a])) as never);
  const events = (name: string) => log.filter((e) => e[0] === name);
  const names = () => log.filter((e) => e[0] !== 'rx:row' && e[0] !== 'rx:progress').map((e) => e[0]);
  return { t, plays, hear, log, events, names, fallback };
}

/** Lets `done` promises settle. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** Finishes the sender's current playback after the receivers have heard it. */
async function air(sender: ReturnType<typeof radio>, ...receivers: ReturnType<typeof radio>[]) {
  const p = sender.plays.at(-1)!;
  for (const r of receivers) r.hear(p.samples);
  p.onProgress?.(0.5);
  p.onProgress?.(1);
  p.resolve();
  await settle();
}

function portrait(r: number, g: number, b: number) {
  const img = new ImageData(240, 320);
  for (let i = 0; i < img.data.length; i += 4) img.data.set([r, g, b, 255], i);
  return img;
}

/** Raw air samples for a packet, as another device would send it. */
const frame = (p: Packet) => fskModulate(encodePacket(p), RATE);
const textFrame = (to: string[], text: string): Packet =>
  ({ kind: 'text', from: 'alice', fromName: 'Alice', to, chatId: 'c1', mode: '', text });

beforeEach(() => {
  fake.state.crcOk = true;
  vi.mocked(encodePacket).mockClear();
  vi.mocked(robot36Modulate).mockClear();
});

describe('audio transport: receive', () => {
  it('delivers a text only to the identity it is addressed to', async () => {
    const alice = radio('alice', 'Alice');
    const bob = radio('bob', 'Bob');
    const carol = radio('carol', 'Carol');

    const h = alice.t.sendText('c1', 'hello');
    expect(h).toMatch(/^atx-/);
    expect(encodePacket).toHaveBeenCalledWith({
      kind: 'text', from: 'alice', fromName: 'Alice', to: ['bob'], chatId: 'c1', mode: '', text: 'hello',
    });
    await air(alice, bob, carol);

    expect(bob.names()).toEqual(['rx:start', 'rx:text-chunk', 'rx:text-chunk', 'rx:text-chunk', 'rx:text-chunk', 'rx:text-chunk', 'rx:text-chunk', 'rx:done']);
    const [, rh, from, kind, mode, meta] = bob.events('rx:start')[0];
    expect(rh).toMatch(/^arx-/);
    expect([from, kind, mode, meta]).toEqual(['alice', 'text', 'two-tone', { fromName: 'Alice', chatId: 'c1' }]);
    expect(bob.events('rx:text-chunk').at(-1)).toEqual(['rx:text-chunk', rh, 'hello']);
    expect(bob.events('rx:done')).toEqual([['rx:done', rh]]);
    expect(carol.log).toEqual([]);
  });

  it('delivers a snap (FSK header, gap, Robot36) only to the identity it is addressed to', async () => {
    const alice = radio('alice', 'Alice');
    const bob = radio('bob', 'Bob');
    const carol = radio('carol', 'Carol');

    alice.t.sendSnap(['c1'], portrait(10, 20, 30));
    expect(encodePacket).toHaveBeenCalledWith({
      kind: 'snap', from: 'alice', fromName: 'Alice', to: ['bob'], chatId: 'c1', mode: 'Robot36', text: '',
    });
    // The portrait snap goes out rotated into the 320×240 Robot36 frame.
    const sent = vi.mocked(robot36Modulate).mock.calls[0][0];
    expect([sent.width, sent.height]).toEqual([320, 240]);
    // Header, then 300 ms of silence, then the image.
    const samples = alice.plays[0].samples;
    const gap = samples.subarray(samples.length - 244 - 0.3 * RATE, samples.length - 244);
    expect(samples[0]).not.toBe(0);
    expect(gap.every((v) => v === 0)).toBe(true);

    await air(alice, bob, carol);

    expect(bob.names()).toEqual(['rx:start', 'rx:done']);
    const [, rh, from, kind, mode, meta] = bob.events('rx:start')[0];
    expect([from, kind, mode, meta]).toEqual(['alice', 'snap', 'Robot36', { fromName: 'Alice', chatId: 'c1' }]);
    const rows = bob.events('rx:row');
    expect(rows).toHaveLength(240);
    expect(rows.map((r) => r[2])).toEqual(Array.from({ length: 240 }, (_, i) => i));
    expect(Array.from((rows[0][3] as Uint8ClampedArray).slice(0, 4))).toEqual([10, 20, 30, 255]);
    expect(rows.every((r) => r[1] === rh)).toBe(true);
    expect(bob.events('rx:progress').at(-1)).toEqual(['rx:progress', rh, 1]);
    expect(carol.log).toEqual([]);
  });

  it('sends a snap to several chats with an empty chatId and every recipient', () => {
    const alice = radio('alice', 'Alice');
    alice.t.sendSnap(['c1', 'grp'], portrait(0, 0, 0));
    const p = vi.mocked(encodePacket).mock.calls[0][0];
    expect(p.chatId).toBe('');
    expect(p.to).toEqual(expect.arrayContaining(['bob', 'carol']));
  });

  it('cancels a text whose CRC fails', () => {
    const bob = radio('bob', 'Bob');
    fake.state.crcOk = false;
    bob.hear(frame(textFrame(['bob'], 'hi')));
    expect(bob.names()).toEqual(['rx:start', 'rx:text-chunk', 'rx:text-chunk', 'rx:cancelled']);
  });

  it('ignores a snap header with a bad CRC', () => {
    const bob = radio('bob', 'Bob');
    fake.state.crcOk = false;
    bob.hear(frame({ ...textFrame(['bob'], ''), kind: 'snap', mode: 'Robot36' }));
    expect(bob.log).toEqual([]);
  });

  it('gives up on a snap with no VIS and goes back to listening for FSK', () => {
    const bob = radio('bob', 'Bob');
    const header = frame({ ...textFrame(['bob'], ''), kind: 'snap', mode: 'Robot36' });
    bob.hear(header);
    bob.hear(Float32Array.of(5)); // noise where the VIS should be
    expect(bob.names()).toEqual(['rx:start', 'rx:cancelled']);
    bob.hear(frame(textFrame(['bob'], 'ok')));
    expect(bob.names().slice(2)).toEqual(['rx:start', 'rx:text-chunk', 'rx:text-chunk', 'rx:text-chunk', 'rx:done']);
  });

  it('stops an incoming snap on cancel', () => {
    const alice = radio('alice', 'Alice');
    const bob = radio('bob', 'Bob');
    alice.t.sendSnap(['c1'], portrait(1, 2, 3));
    const samples = alice.plays[0].samples;
    bob.hear(samples.subarray(0, samples.length - 200));
    const h = bob.events('rx:start')[0][1] as string;
    const rowsBefore = bob.events('rx:row').length;
    expect(rowsBefore).toBeGreaterThan(0);
    bob.t.cancel(h);
    bob.hear(samples.subarray(samples.length - 200));
    expect(bob.events('rx:row')).toHaveLength(rowsBefore);
    expect(bob.names()).toEqual(['rx:start', 'rx:cancelled']);
  });
});

describe('audio transport: send queue', () => {
  it('sends one at a time, first in first out, with progress from playback', async () => {
    const alice = radio('alice', 'Alice');
    const a = alice.t.sendText('c1', 'one');
    const b = alice.t.sendText('c1', 'two');
    expect(alice.log).toEqual([['tx:start', a], ['tx:queued', b, ['c1']]]);
    expect(alice.plays).toHaveLength(1);

    await air(alice);
    expect(alice.events('tx:progress')).toEqual([['tx:progress', a, 0.5], ['tx:progress', a, 1]]);
    expect(alice.names().slice(2)).toEqual(['tx:progress', 'tx:progress', 'tx:done', 'tx:start']);
    expect(alice.events('tx:start')[1]).toEqual(['tx:start', b]);
    expect(alice.plays).toHaveLength(2);
  });

  it('waits for an incoming snap to finish before transmitting (half duplex)', async () => {
    const alice = radio('alice', 'Alice');
    const bob = radio('bob', 'Bob');
    alice.t.sendSnap(['c1'], portrait(1, 2, 3));
    const samples = alice.plays[0].samples;
    bob.hear(samples.subarray(0, samples.length - 100));

    const h = bob.t.sendText('c1', 'reply');
    expect(bob.events('tx:queued')).toEqual([['tx:queued', h, ['c1']]]);
    expect(bob.plays).toHaveLength(0);

    bob.hear(samples.subarray(samples.length - 100));
    expect(bob.names().slice(-2)).toEqual(['rx:done', 'tx:start']);
    expect(bob.plays).toHaveLength(1);
  });

  it('cancel drops a queued send, and stops the active one so the next starts', () => {
    const alice = radio('alice', 'Alice');
    const a = alice.t.sendText('c1', '1');
    const b = alice.t.sendText('c1', '2');
    const c = alice.t.sendText('c1', '3');
    alice.t.cancel(b);
    expect(alice.events('tx:cancelled')).toEqual([['tx:cancelled', b]]);
    alice.t.cancel(a);
    expect(alice.plays[0].stopped).toBe(true);
    expect(alice.events('tx:cancelled')).toEqual([['tx:cancelled', b], ['tx:cancelled', a]]);
    expect(alice.events('tx:start').map((e) => e[1])).toEqual([a, c]);
  });

  it('reports a send that cannot be modulated as cancelled and moves on', () => {
    const alice = radio('alice', 'Alice');
    vi.mocked(fskModulate).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = alice.t.sendText('c1', 'x');
    expect(alice.log).toEqual([['tx:cancelled', a]]);
    err.mockRestore();
    const b = alice.t.sendText('c1', 'y');
    expect(alice.log.at(-1)).toEqual(['tx:start', b]);
  });
});

describe('audio transport: simulateIncoming', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('delegates to the fallback transport and forwards its events under its own handles', () => {
    const alice = radio('alice', 'Alice');
    const spy = vi.spyOn(alice.fallback, 'simulateIncoming');
    const h = alice.t.simulateIncoming('jen', 'text', 'hi');
    expect(spy).toHaveBeenCalledWith('jen', 'text', 'hi', undefined);
    expect(h).not.toMatch(/^a[tr]x-/);
    expect(alice.log[0]).toEqual(['rx:start', h, 'jen', 'text', 'Robot36']);
    vi.advanceTimersByTime(200);
    expect(alice.events('rx:done')).toEqual([['rx:done', h]]);
  });

  it('holds sends while a simulated receive runs, and cancel reaches the fallback', () => {
    const alice = radio('alice', 'Alice');
    const rx = alice.t.simulateIncoming('jen', 'snap', new ImageData(240, 320));
    const tx = alice.t.sendText('c1', 'hey');
    expect(alice.events('tx:queued')).toEqual([['tx:queued', tx, ['c1']]]);
    alice.t.cancel(rx);
    expect(alice.events('rx:cancelled')).toEqual([['rx:cancelled', rx]]);
    expect(alice.events('tx:start')).toEqual([['tx:start', tx]]);
  });
});
