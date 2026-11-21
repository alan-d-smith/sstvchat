import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { AppProvider } from '../state/store';
import type { Transport, TransportEvents } from '../sim/transport';
import { paintRow } from '../sim/rotate';
import { SnapCanvas } from './SnapCanvas';

vi.mock('../sim/rotate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sim/rotate')>();
  return { ...actual, paintRow: vi.fn(actual.paintRow) };
});

/** Minimal transport whose events the test fires by hand. */
function fakeTransport() {
  type AnyFn = (...a: unknown[]) => void;
  const listeners = new Map<string, Set<AnyFn>>();
  const transport: Transport = {
    sendText: vi.fn(() => 'tx-x'),
    sendSnap: vi.fn(() => 'tx-x'),
    simulateIncoming: vi.fn(() => 'rx-x'),
    cancel: vi.fn(),
    on(event, fn) {
      const set = listeners.get(event) ?? new Set<AnyFn>();
      listeners.set(event, set);
      set.add(fn as unknown as AnyFn);
      return () => set.delete(fn as unknown as AnyFn);
    },
  };
  const emit = <K extends keyof TransportEvents>(event: K, ...args: Parameters<TransportEvents[K]>) =>
    act(() => {
      for (const fn of [...(listeners.get(event) ?? [])]) fn(...args);
    });
  return { transport, emit };
}

const row = (v: number) => new Uint8ClampedArray(320 * 4).fill(v);

function setup(handle = 'rx-1') {
  const { transport, emit } = fakeTransport();
  const utils = render(
    <AppProvider transport={transport}>
      <SnapCanvas handle={handle} />
    </AppProvider>,
  );
  const scan = () => utils.container.querySelector<HTMLElement>('.snap-canvas__scan');
  return { ...utils, emit, scan };
}

let ctx: { putImageData: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.mocked(paintRow).mockClear();
  ctx = { putImageData: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
});

describe('SnapCanvas', () => {
  it('renders a 240x320 portrait canvas', () => {
    const { container } = setup();
    const canvas = container.querySelector('canvas')!;
    expect(canvas.width).toBe(240);
    expect(canvas.height).toBe(320);
  });

  it('paints each rx:row for its handle once and ignores other handles', () => {
    const { emit } = setup('rx-1');
    const r0 = row(10);
    const r1 = row(20);
    emit('rx:row', 'rx-1', 0, r0);
    emit('rx:row', 'rx-2', 0, row(99));
    emit('rx:row', 'rx-1', 1, r1);
    emit('rx:row', 'rx-2', 1, row(99));

    expect(paintRow).toHaveBeenCalledTimes(2);
    expect(paintRow).toHaveBeenNthCalledWith(1, expect.any(ImageData), 0, r0);
    expect(paintRow).toHaveBeenNthCalledWith(2, expect.any(ImageData), 1, r1);
  });

  it('paints into a 240x320 buffer that starts opaque black', () => {
    const { emit } = setup();
    emit('rx:row', 'rx-1', 0, row(255));
    const buffer = vi.mocked(paintRow).mock.calls[0][0];
    expect(buffer.width).toBe(240);
    expect(buffer.height).toBe(320);
    // Column 1 is untouched: opaque black.
    expect(Array.from(buffer.data.slice(4, 8))).toEqual([0, 0, 0, 255]);
  });

  it('moves the scan line to the paint front and hides it when the receive ends', () => {
    const { emit, scan } = setup();
    expect(scan()).not.toBeNull();
    emit('rx:row', 'rx-1', 0, row(1));
    emit('rx:row', 'rx-1', 119, row(1));
    expect(scan()!.style.left).toBe('50%');
    emit('rx:done', 'rx-2');
    expect(scan()).not.toBeNull();
    emit('rx:done', 'rx-1');
    expect(scan()).toBeNull();
  });

  it('starts from the rows that arrived before it was opened (no black left side)', () => {
    const { transport, emit } = fakeTransport();
    const { rerender } = render(<AppProvider transport={transport}><div /></AppProvider>);
    emit('rx:start', 'rx-1', 'julie', 'snap', 'Robot36', { chatId: 'julie' });
    emit('rx:row', 'rx-1', 0, row(9));
    rerender(<AppProvider transport={transport}><SnapCanvas handle="rx-1" /></AppProvider>);
    const first = ctx.putImageData.mock.calls[0][0] as ImageData;
    // Portrait column 0 (landscape row 0) is already painted; column 1 is still black.
    expect(Array.from(first.data.slice(0, 4))).toEqual([9, 9, 9, 9]);
    expect(Array.from(first.data.slice(4, 8))).toEqual([0, 0, 0, 255]);
  });

  it('hides the scan line when its receive is cancelled', () => {
    const { emit, scan } = setup();
    emit('rx:row', 'rx-1', 10, row(1));
    emit('rx:cancelled', 'rx-1');
    expect(scan()).toBeNull();
  });
});
