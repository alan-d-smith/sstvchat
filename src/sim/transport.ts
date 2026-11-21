import { rotateCW } from './rotate';

export type Handle = string;
export const MODE = 'Robot36';

export interface TransportEvents {
  'tx:queued': (h: Handle, chatIds: string[]) => void;
  'tx:start': (h: Handle) => void;
  'tx:progress': (h: Handle, p: number) => void;
  'tx:done': (h: Handle) => void;
  'tx:cancelled': (h: Handle) => void;
  'rx:start': (
    h: Handle,
    from: string,
    kind: 'snap' | 'text',
    mode: string,
    meta?: { fromName?: string; chatId?: string },
  ) => void;
  'rx:row': (h: Handle, index: number, row: Uint8ClampedArray) => void;
  'rx:text-chunk': (h: Handle, textSoFar: string) => void;
  'rx:progress': (h: Handle, p: number) => void;
  'rx:done': (h: Handle) => void;
  'rx:cancelled': (h: Handle) => void;
}

export interface Transport {
  sendText(chatId: string, text: string): Handle;
  sendSnap(chatIds: string[], image: ImageData): Handle;
  simulateIncoming(
    from: string,
    kind: 'snap' | 'text',
    payload: ImageData | string,
    startAt?: number,
  ): Handle;
  cancel(h: Handle): void;
  on<K extends keyof TransportEvents>(event: K, fn: TransportEvents[K]): () => void;
}

const ROWS = 240;
const TICK_MS = 50;

type Job =
  | { dir: 'tx'; handle: Handle; kind: 'text' | 'snap'; chatIds: string[]; startAt: number }
  | { dir: 'rx'; handle: Handle; kind: 'snap'; from: string; landscape: ImageData; startAt: number }
  | { dir: 'rx'; handle: Handle; kind: 'text'; from: string; text: string; startAt: number };

export function createMockTransport(opts: { snapMs?: number; textMs?: number } = {}): Transport {
  const snapMs = opts.snapMs ?? 9000;
  const textMs = opts.textMs ?? 1500;

  type AnyFn = (...a: unknown[]) => void;
  const listeners: Partial<Record<keyof TransportEvents, Set<AnyFn>>> = {};
  const emit = <K extends keyof TransportEvents>(
    event: K,
    ...args: Parameters<TransportEvents[K]>
  ): void => {
    const set = listeners[event];
    if (!set) return;
    for (const fn of [...set]) fn(...args);
  };

  let counter = 0;
  const queue: Job[] = [];
  let active: Job | null = null;
  let startTime = 0;
  let rowsSent = 0;
  let charsSent = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const duration = (j: Job) => (j.kind === 'snap' ? snapMs : textMs);

  function stopTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function startNext() {
    active = null;
    const next = queue.shift();
    if (!next) {
      stopTimer();
      return;
    }
    begin(next);
  }

  function begin(job: Job) {
    active = job;
    startTime = Date.now();
    rowsSent = 0;
    charsSent = 0;
    if (job.dir === 'tx') {
      emit('tx:start', job.handle);
    } else {
      emit('rx:start', job.handle, job.from, job.kind, MODE);
      if (job.kind === 'snap') {
        const upTo = Math.floor(job.startAt * ROWS);
        emitRows(job, upTo);
      }
    }
    if (timer === null) timer = setInterval(tick, TICK_MS);
    // Report initial progress for jobs that resume part-way.
    if (job.startAt > 0) report(job, job.startAt);
  }

  function emitRows(job: Extract<Job, { dir: 'rx'; kind: 'snap' }>, upTo: number) {
    const stride = 320 * 4;
    while (rowsSent < upTo && rowsSent < ROWS) {
      const i = rowsSent++;
      emit('rx:row', job.handle, i, job.landscape.data.slice(i * stride, (i + 1) * stride));
      if (active !== job) return; // cancelled by a listener
    }
  }

  function report(job: Job, p: number) {
    if (job.dir === 'tx') emit('tx:progress', job.handle, p);
    else emit('rx:progress', job.handle, p);
  }

  function tick() {
    const job = active;
    if (!job) {
      stopTimer();
      return;
    }
    const elapsed = Date.now() - startTime;
    const remaining = duration(job) * (1 - job.startAt);
    const frac = remaining <= 0 ? 1 : Math.min(1, elapsed / remaining);
    const p = job.startAt + (1 - job.startAt) * frac;

    if (job.dir === 'rx') {
      if (job.kind === 'snap') {
        emitRows(job, frac >= 1 ? ROWS : Math.floor(p * ROWS));
      } else {
        const n = frac >= 1 ? job.text.length : Math.ceil(p * job.text.length);
        if (n > charsSent) {
          charsSent = n;
          emit('rx:text-chunk', job.handle, job.text.slice(0, n));
        }
      }
      if (active !== job) return;
    }

    report(job, p);
    if (active !== job) return;

    if (frac >= 1) {
      if (job.dir === 'tx') emit('tx:done', job.handle);
      else emit('rx:done', job.handle);
      if (active === job) startNext();
    }
  }

  function enqueue(job: Job, chatIds?: string[]) {
    if (active === null && queue.length === 0) {
      begin(job);
    } else {
      queue.push(job);
      if (chatIds) emit('tx:queued', job.handle, chatIds);
    }
  }

  return {
    sendText(chatId, text) {
      void text;
      const handle = `tx-${++counter}`;
      enqueue({ dir: 'tx', handle, kind: 'text', chatIds: [chatId], startAt: 0 }, [chatId]);
      return handle;
    },
    sendSnap(chatIds, image) {
      void image;
      const handle = `tx-${++counter}`;
      enqueue({ dir: 'tx', handle, kind: 'snap', chatIds: [...chatIds], startAt: 0 }, [...chatIds]);
      return handle;
    },
    simulateIncoming(from, kind, payload, startAt = 0) {
      const handle = `rx-${++counter}`;
      const s = Math.min(1, Math.max(0, startAt));
      if (kind === 'snap') {
        enqueue({ dir: 'rx', handle, kind: 'snap', from, landscape: rotateCW(payload as ImageData), startAt: s });
      } else {
        enqueue({ dir: 'rx', handle, kind: 'text', from, text: String(payload), startAt: 0 });
      }
      return handle;
    },
    cancel(h) {
      if (active && active.handle === h) {
        const job = active;
        emit(job.dir === 'tx' ? 'tx:cancelled' : 'rx:cancelled', h);
        if (active === job) startNext();
        return;
      }
      const i = queue.findIndex((j) => j.handle === h);
      if (i < 0) return;
      const [job] = queue.splice(i, 1);
      emit(job.dir === 'tx' ? 'tx:cancelled' : 'rx:cancelled', h);
    },
    on(event, fn) {
      const set = (listeners[event] ??= new Set<AnyFn>());
      const f = fn as unknown as AnyFn;
      set.add(f);
      return () => {
        set.delete(f);
      };
    },
  };
}
