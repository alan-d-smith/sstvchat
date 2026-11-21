// Transport over real audio: text as a two-tone FSK packet, snaps as an FSK header packet then
// Robot36. Half duplex with one FIFO send queue. Incoming frames are accepted only when their
// header addresses this device's identity and was not sent by it. Every packet carries a short
// message id; the same sender + id heard again (a looped recording, an echo) is ignored. The mock
// transport stays behind `simulateIncoming` so mock chats and the demo panel keep working.

import type { Handle, Transport, TransportEvents } from '../sim/transport';
import { MODE } from '../sim/transport';
import { rotateCW } from '../sim/rotate';
import { encodePacket } from './packet';
import type { Packet, PacketHeader } from './packet';
import { FskReceiver, fskDurationMs, fskModulate } from './fsk';
import { Robot36Receiver, robot36Modulate } from './robot36';
import type { AudioEngine } from './engine';
import { createRadioDiag } from './diagnostics';
import type { RadioDiag } from './diagnostics';

export interface Identity { id: string; name: string }

/** `mode` reported on rx:start for text. */
export const TEXT_MODE = 'two-tone';
/** Silence between a snap's FSK header and its SSTV image. */
export const HEADER_GAP_MS = 300;
/** How long to wait for the VIS code after a snap header before giving up. */
export const VIS_TIMEOUT_MS = 4000;
/** How long a received message id is remembered. */
export const REPEAT_WINDOW_MS = 60 * 60 * 1000;

/** Received message ids (`from:id` → when), kept by the app across reloads. */
export interface HeardIds {
  load(): Record<string, number>;
  save(heard: Record<string, number>): void;
}

/** Longest chat text (the input's maxLength): two-tone FSK carries about 10 bytes a second. */
export const MAX_TEXT = 140;
/** Packet bytes around a text with typical usernames: framing 7 + 7 separators + kind + ids ≈ 40. */
const TEXT_HEADER_BYTES = 40;
const utf8 = new TextEncoder();

/** About how long `text` takes on air, in ms. */
export function textAirtimeMs(text: string): number {
  return fskDurationMs(TEXT_HEADER_BYTES + utf8.encode(text).length);
}

/** Short random per-message id (4 base-36 chars). */
export const newMessageId = () => Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');

const EVENTS: (keyof TransportEvents)[] = [
  'tx:queued', 'tx:start', 'tx:progress', 'tx:done', 'tx:cancelled',
  'rx:start', 'rx:row', 'rx:text-chunk', 'rx:progress', 'rx:done', 'rx:cancelled',
];

interface TxJob {
  handle: Handle;
  chatIds: string[];
  build(sampleRate: number): Float32Array;
  player?: { stop(): void };
}

type RxState =
  | { mode: 'idle' }
  | { mode: 'ignore'; reason: string; header?: PacketHeader } // e.g. a frame addressed to someone else
  | { mode: 'text'; handle: Handle; header: PacketHeader }
  | { mode: 'snap-header'; header: PacketHeader } // waiting for the header packet's CRC
  | { mode: 'sstv'; handle: Handle; rx: Robot36Receiver };

const IDLE: RxState = { mode: 'idle' };

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const metaOf = (h: PacketHeader) => ({ fromName: h.fromName || undefined, chatId: h.chatId || undefined });

/** The audio transport, plus read-only diagnostics (counters and the last decisions). */
export type AudioTransport = Transport & { diag: RadioDiag };

export function createAudioTransport(opts: {
  engine: AudioEngine;
  self: () => Identity;
  recipients: (chatIds: string[]) => string[]; // person ids for those chats, excluding self
  fallback: Transport; // mock transport, used by simulateIncoming
  heard?: HeardIds;
}): AudioTransport {
  const { engine, fallback } = opts;
  const diag = createRadioDiag({ receivingImage: () => rx.mode === 'sstv' });
  const note = (h: PacketHeader | undefined, decision: string) =>
    diag.add({ kind: h?.kind ?? '?', from: h?.from ?? '', to: h?.to ?? [], id: h?.id ?? '', decision });

  type AnyFn = (...a: unknown[]) => void;
  const listeners = new Map<keyof TransportEvents, Set<AnyFn>>();
  const emitAny = (event: keyof TransportEvents, args: unknown[]) => {
    for (const fn of [...(listeners.get(event) ?? [])]) fn(...args);
  };
  const emit = <K extends keyof TransportEvents>(event: K, ...args: Parameters<TransportEvents[K]>) =>
    emitAny(event, args);

  let counter = 0;
  const isOwn = (h: Handle) => h.startsWith('atx-') || h.startsWith('arx-');

  /* ---------- receive ---------- */

  let rx: RxState = IDLE;
  let fsk: FskReceiver | null = null;
  let fskRate = 0;
  let warned = false;
  const rxBusy = () => rx.mode === 'text' || rx.mode === 'snap-header' || rx.mode === 'sstv';
  /** For this device: addressed to it, not its own transmission leaking into the mic. */
  const addressed = (h: PacketHeader) => {
    const me = opts.self().id;
    return h.from !== me && h.to.includes(me);
  };

  /** Message ids already received: the same sender + id again is a repeat of that message. */
  const seen = new Map<string, number>(Object.entries(opts.heard?.load() ?? {}));
  const seenKey = (h: PacketHeader) => (h.id ? `${h.from}:${h.id}` : null);
  const isRepeat = (h: PacketHeader) => {
    const k = seenKey(h);
    const at = k === null ? undefined : seen.get(k);
    return at !== undefined && Date.now() - at < REPEAT_WINDOW_MS;
  };
  const saveSeen = () => opts.heard?.save(Object.fromEntries(seen));
  const remember = (h: PacketHeader) => {
    const k = seenKey(h);
    if (k === null) return;
    const now = Date.now();
    for (const [key, at] of seen) if (now - at >= REPEAT_WINDOW_MS) seen.delete(key);
    seen.set(k, now);
    saveSeen();
  };
  const forget = (h: PacketHeader) => {
    const k = seenKey(h);
    if (k !== null && seen.delete(k)) saveSeen();
  };

  /** Why this device ignores a header, or null when it accepts it. */
  const ignoreReason = (h: PacketHeader): string | null => {
    const me = opts.self().id;
    if (h.from === me) return 'own packet';
    if (!h.to.includes(me)) return `not addressed to ${me}`;
    if (isRepeat(h)) return 'repeat';
    return null;
  };

  function onHeader(h: PacketHeader) {
    diag.count('headers');
    const reason = ignoreReason(h);
    if (reason !== null) {
      rx = { mode: 'ignore', reason, header: h };
      return;
    }
    if (h.kind === 'text') {
      const handle = `arx-${++counter}`;
      rx = { mode: 'text', handle, header: h };
      emit('rx:start', handle, h.from, 'text', TEXT_MODE, metaOf(h));
    } else {
      rx = { mode: 'snap-header', header: h };
    }
  }

  function onPacket(p: Packet, crcOk: boolean) {
    diag.count(crcOk ? 'crcOk' : 'crcFail');
    if (crcOk && p.kind === 'snap') diag.count('snapHeaders');
    if (rx.mode === 'idle') onHeader(p); // the parser never reported the header on its own
    const cur = rx;
    rx = IDLE;
    if (cur.mode === 'text') {
      if (crcOk) {
        remember(p);
        note(p, 'accepted');
        emit('rx:text-chunk', cur.handle, p.text);
        emit('rx:done', cur.handle);
      } else {
        note(p, 'CRC fail');
        emit('rx:cancelled', cur.handle);
      }
    } else if (cur.mode === 'snap-header' && crcOk && p.kind === 'snap' && addressed(p) && !isRepeat(p)) {
      remember(p);
      note(p, 'accepted → SSTV');
      startSstv(p);
    } else if (cur.mode === 'ignore') {
      note(p, `ignored: ${cur.reason}${crcOk ? '' : ' (CRC fail)'}`);
    } else {
      note(p, crcOk ? `ignored: ${ignoreReason(p) ?? 'unexpected'}` : 'CRC fail');
    }
    pump();
  }

  function onAbort() {
    diag.count('aborts');
    const cur = rx;
    rx = IDLE;
    if (cur.mode === 'text' || cur.mode === 'snap-header' || cur.mode === 'ignore') {
      note(cur.header, cur.mode === 'ignore' ? `aborted (was ignored: ${cur.reason})` : 'aborted: frame lost before CRC');
    }
    if (cur.mode === 'text') emit('rx:cancelled', cur.handle);
    pump();
  }

  function startSstv(p: Packet) {
    const handle = `arx-${++counter}`;
    const mine = () => rx.mode === 'sstv' && rx.handle === handle;
    const receiver = new Robot36Receiver(engine.sampleRate, {
      onRow: (i, row) => {
        if (mine()) emit('rx:row', handle, i, row);
      },
      onProgress: (q) => {
        if (mine()) emit('rx:progress', handle, q);
      },
      onStart: () => {
        diag.count('sstvStarted');
        note(p, 'SSTV: VIS found, receiving');
      },
      onDone: () => {
        diag.count('sstvDone');
        note(p, 'SSTV: done (240 lines)');
        endSstv(handle, 'rx:done');
      },
      onTimeout: () => {
        diag.count('visTimeouts');
        note(p, `SSTV: no VIS within ${VIS_TIMEOUT_MS / 1000} s`);
        forget(p); // nothing arrived: a repeat of this snap may still be received
        endSstv(handle, 'rx:cancelled');
      },
    }, { visTimeoutMs: VIS_TIMEOUT_MS });
    rx = { mode: 'sstv', handle, rx: receiver };
    emit('rx:start', handle, p.from, 'snap', MODE, metaOf(p));
  }

  function endSstv(handle: Handle, event: 'rx:done' | 'rx:cancelled') {
    if (rx.mode !== 'sstv' || rx.handle !== handle) return;
    rx = IDLE;
    fsk?.reset();
    emit(event, handle);
    pump();
  }

  function feed(chunk: Float32Array) {
    try {
      if (rx.mode === 'sstv') {
        rx.rx.push(chunk);
        return;
      }
      const rate = engine.sampleRate;
      if (!fsk || fskRate !== rate) {
        fsk = new FskReceiver(rate, {
          onFrameStart: () => diag.count('frames'),
          onHeader,
          onTextChunk: (t) => {
            if (rx.mode === 'text') emit('rx:text-chunk', rx.handle, t);
          },
          onPacket,
          onAbort,
        });
        fskRate = rate;
      }
      const before = fsk.bytesDecoded;
      fsk.push(chunk);
      diag.count('bytes', Math.max(0, fsk.bytesDecoded - before));
    } catch (e) {
      if (!warned) console.error('[radio] receiver failed', e);
      warned = true;
    }
  }

  engine.onSamples(feed);

  /* ---------- transmit ---------- */

  const queue: TxJob[] = [];
  let active: TxJob | null = null;
  const fallbackRx = new Set<Handle>();
  const canStart = () => active === null && !rxBusy() && fallbackRx.size === 0;

  function begin(job: TxJob) {
    let samples: Float32Array;
    try {
      samples = job.build(engine.sampleRate);
    } catch (e) {
      console.error('[radio] could not modulate', e);
      emit('tx:cancelled', job.handle);
      return;
    }
    active = job;
    emit('tx:start', job.handle);
    if (active !== job) return; // cancelled by a listener
    const player = engine.play(samples, (p) => {
      if (active === job) emit('tx:progress', job.handle, p);
    });
    job.player = player;
    player.done.then(
      () => finish(job, 'tx:done'),
      () => finish(job, 'tx:cancelled'),
    );
  }

  function finish(job: TxJob, event: 'tx:done' | 'tx:cancelled') {
    if (active !== job) return;
    active = null;
    emit(event, job.handle);
    pump();
  }

  function pump() {
    while (canStart() && queue.length > 0) begin(queue.shift()!);
  }

  function enqueue(job: TxJob) {
    if (canStart() && queue.length === 0) {
      begin(job);
    } else {
      queue.push(job);
      emit('tx:queued', job.handle, [...job.chatIds]);
    }
  }

  function header(kind: Packet['kind'], chatIds: string[], chatId: string, text: string): Uint8Array {
    const me = opts.self();
    return encodePacket({
      kind,
      from: me.id,
      fromName: me.name === me.id ? '' : me.name, // airtime: no need to repeat the address
      to: opts.recipients(chatIds).filter((id) => id !== me.id),
      chatId,
      mode: kind === 'snap' ? MODE : '',
      id: newMessageId(),
      text,
    });
  }

  /* ---------- mock fallback (simulateIncoming) ---------- */

  for (const event of EVENTS) {
    fallback.on(event, ((...args: unknown[]) => {
      const h = args[0] as Handle;
      if (event === 'rx:start') fallbackRx.add(h);
      const ended = (event === 'rx:done' || event === 'rx:cancelled') && fallbackRx.delete(h);
      emitAny(event, args);
      if (ended) pump();
    }) as TransportEvents[typeof event]);
  }

  return {
    diag,
    sendText(chatId, text) {
      const handle = `atx-${++counter}`;
      enqueue({
        handle,
        chatIds: [chatId],
        build: (rate) => fskModulate(header('text', [chatId], chatId, text), rate),
      });
      return handle;
    },
    sendSnap(chatIds, image) {
      const handle = `atx-${++counter}`;
      const ids = [...chatIds];
      enqueue({
        handle,
        chatIds: ids,
        build: (rate) => concat([
          fskModulate(header('snap', ids, ids.length === 1 ? ids[0] : '', ''), rate),
          new Float32Array(Math.round((rate * HEADER_GAP_MS) / 1000)),
          robot36Modulate(rotateCW(image), rate),
        ]),
      });
      return handle;
    },
    simulateIncoming(from, kind, payload, startAt) {
      return fallback.simulateIncoming(from, kind, payload, startAt);
    },
    cancel(h) {
      if (!isOwn(h)) {
        fallback.cancel(h);
        return;
      }
      if (active?.handle === h) {
        const job = active;
        active = null;
        job.player?.stop();
        emit('tx:cancelled', h);
        pump();
        return;
      }
      const i = queue.findIndex((j) => j.handle === h);
      if (i >= 0) {
        queue.splice(i, 1);
        emit('tx:cancelled', h);
        return;
      }
      if (rx.mode === 'sstv' && rx.handle === h) {
        const receiver = rx.rx;
        rx = IDLE;
        receiver.abort();
        fsk?.reset();
        emit('rx:cancelled', h);
        pump();
      } else if (rx.mode === 'text' && rx.handle === h) {
        rx = { mode: 'ignore', reason: 'stopped', header: rx.header }; // drop the rest of this frame
        emit('rx:cancelled', h);
        pump();
      }
    },
    on(event, fn) {
      const set = listeners.get(event) ?? new Set<AnyFn>();
      listeners.set(event, set);
      const f = fn as unknown as AnyFn;
      set.add(f);
      return () => {
        set.delete(f);
      };
    },
  };
}
