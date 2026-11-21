import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIsMobile } from './useIsMobile';

type Listener = (e: { matches: boolean }) => void;

function mockMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const mql = {
    matches: initial,
    media: '(max-width: 767px)',
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  };
  const spy = vi.fn(() => mql);
  vi.stubGlobal('matchMedia', spy);
  return {
    spy,
    set(matches: boolean) {
      mql.matches = matches;
      listeners.forEach((fn) => fn({ matches }));
    },
  };
}

describe('useIsMobile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is true when the mobile query matches', () => {
    const m = mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    expect(m.spy).toHaveBeenCalledWith('(max-width: 767px)');
  });

  it('is false when it does not match', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('updates on change events', () => {
    const m = mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    act(() => m.set(true));
    expect(result.current).toBe(true);
    act(() => m.set(false));
    expect(result.current).toBe(false);
  });
});
