import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE, createMockTransport, type Transport } from './transport';

const img = () => new ImageData(240, 320);

function setup() {
  const t: Transport = createMockTransport({ snapMs: 9000, textMs: 1500 });
  const log: [string, ...unknown[]][] = [];
  for (const ev of [
    'tx:queued', 'tx:start', 'tx:progress', 'tx:done', 'tx:cancelled',
    'rx:start', 'rx:row', 'rx:text-chunk', 'rx:progress', 'rx:done', 'rx:cancelled',
  ] as const) {
    t.on(ev, ((...a: unknown[]) => log.push([ev, ...a])) as never);
  }
  const names = () => log.map((l) => l[0]);
  return { t, log, names };
}

describe('mock transport', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sendText runs start, progress, done at 1500ms', () => {
    const { t, log, names } = setup();
    const h = t.sendText('c1', 'hi');
    expect(h).toBe('tx-1');
    expect(names()).toEqual(['tx:start']);
    vi.advanceTimersByTime(1400);
    expect(names()).not.toContain('tx:done');
    vi.advanceTimersByTime(100);
    expect(names()[names().length - 1]).toBe('tx:done');
    const prog = log.filter((l) => l[0] === 'tx:progress').map((l) => l[2] as number);
    expect(prog.length).toBeGreaterThan(3);
    for (let i = 1; i < prog.length; i++) expect(prog[i]).toBeGreaterThanOrEqual(prog[i - 1]);
  });

  it('receives a snap: 240 ordered rows, done at 9000ms', () => {
    const { t, log, names } = setup();
    const h = t.simulateIncoming('beatriz', 'snap', img());
    expect(log[0]).toEqual(['rx:start', h, 'beatriz', 'snap', MODE]);
    vi.advanceTimersByTime(8900);
    expect(names()).not.toContain('rx:done');
    vi.advanceTimersByTime(100);
    const rows = log.filter((l) => l[0] === 'rx:row');
    expect(rows.map((r) => r[2])).toEqual(Array.from({ length: 240 }, (_, i) => i));
    expect((rows[0][3] as Uint8ClampedArray).length).toBe(320 * 4);
    expect(names()[names().length - 1]).toBe('rx:done');
  });

  it('startAt 0.62 emits earlier rows synchronously and finishes ~3420ms', () => {
    const { t, log, names } = setup();
    t.simulateIncoming('beatriz', 'snap', img(), 0.62);
    const sync = log.filter((l) => l[0] === 'rx:row').map((r) => r[2] as number);
    expect(sync).toEqual(Array.from({ length: 148 }, (_, i) => i));
    vi.advanceTimersByTime(3300);
    expect(names()).not.toContain('rx:done');
    vi.advanceTimersByTime(200);
    expect(names()).toContain('rx:done');
    const idx = log.filter((l) => l[0] === 'rx:row').map((r) => r[2]);
    expect(idx).toEqual(Array.from({ length: 240 }, (_, i) => i));
    const prog = log.filter((l) => l[0] === 'rx:progress').map((l) => l[2] as number);
    expect(prog[0]).toBeGreaterThanOrEqual(0.62);
  });

  it('queues sends while busy and starts after rx:done', () => {
    const { t, log, names } = setup();
    t.simulateIncoming('beatriz', 'snap', img());
    vi.advanceTimersByTime(1000);
    const h = t.sendSnap(['c1', 'c2'], img());
    const q = log.find((l) => l[0] === 'tx:queued');
    expect(q).toEqual(['tx:queued', h, ['c1', 'c2']]);
    expect(names()).not.toContain('tx:start');
    vi.advanceTimersByTime(8100);
    const n = names();
    expect(n.indexOf('tx:start')).toBeGreaterThan(n.indexOf('rx:done'));
  });

  it('runs two sendText back-to-back sequentially', () => {
    const { t, names } = setup();
    t.sendText('c1', 'a');
    t.sendText('c1', 'b');
    expect(names()).toEqual(['tx:start', 'tx:queued']);
    vi.advanceTimersByTime(1500);
    expect(names().filter((n) => n === 'tx:done').length).toBe(1);
    expect(names().filter((n) => n === 'tx:start').length).toBe(2);
    vi.advanceTimersByTime(1500);
    expect(names().filter((n) => n === 'tx:done').length).toBe(2);
  });

  it('cancels mid-receive, stops rows, starts next', () => {
    const { t, log, names } = setup();
    const h = t.simulateIncoming('beatriz', 'snap', img());
    t.sendText('c1', 'x');
    vi.advanceTimersByTime(4500);
    t.cancel(h);
    expect(names()).toContain('rx:cancelled');
    const rowsAt = log.filter((l) => l[0] === 'rx:row').length;
    expect(names()).toContain('tx:start');
    vi.advanceTimersByTime(3000);
    expect(log.filter((l) => l[0] === 'rx:row').length).toBe(rowsAt);
    expect(names()).toContain('tx:done');
  });

  it('cancelling a queued job removes it', () => {
    const { t, log, names } = setup();
    t.sendText('c1', 'a');
    const h = t.sendText('c1', 'b');
    t.cancel(h);
    expect(log.find((l) => l[0] === 'tx:cancelled')).toEqual(['tx:cancelled', h]);
    vi.advanceTimersByTime(5000);
    expect(names().filter((n) => n === 'tx:start').length).toBe(1);
  });

  it('streams incoming text as growing prefixes', () => {
    const { t, log, names } = setup();
    t.simulateIncoming('beatriz', 'text', 'hello there');
    vi.advanceTimersByTime(1600);
    const chunks = log.filter((l) => l[0] === 'rx:text-chunk').map((l) => l[2] as string);
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startsWith(chunks[i - 1])).toBe(true);
      expect(chunks[i].length).toBeGreaterThan(chunks[i - 1].length);
    }
    expect(chunks[chunks.length - 1]).toBe('hello there');
    expect(names()[names().length - 1]).toBe('rx:done');
  });

  it('unsubscribe stops delivery', () => {
    const t = createMockTransport();
    const fn = vi.fn();
    const off = t.on('tx:start', fn);
    t.sendText('c', 'a');
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    t.sendText('c', 'b');
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
