import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeHintDismissedRecently, HINT_QUIET_MS, saveDecodeHintDismissed } from './persist';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('decode hint dismissal', () => {
  it('keeps the hint away for 24 h after a dismiss', () => {
    const t0 = 1_800_000_000_000;
    expect(decodeHintDismissedRecently(t0)).toBe(false);
    saveDecodeHintDismissed(t0);
    expect(decodeHintDismissedRecently(t0 + HINT_QUIET_MS - 1)).toBe(true);
    expect(decodeHintDismissedRecently(t0 + HINT_QUIET_MS)).toBe(false);
  });

  it('never throws when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => saveDecodeHintDismissed()).not.toThrow();
    expect(decodeHintDismissedRecently()).toBe(false);
  });
});
