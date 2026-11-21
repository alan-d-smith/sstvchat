import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// No network in tests: the store asks /api/users on mount. Tests that need it mock fetch themselves.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network disabled in tests'); }));
});

// globals: false disables RTL auto-cleanup, so unmount between tests here. The store persists
// chats (localStorage) and the username (cookie), so wipe both too.
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  // Node-environment tests (the audio modems) have no DOM storage.
  if (typeof localStorage !== 'undefined') localStorage.clear();
  if (typeof document !== 'undefined') document.cookie = 'sstv_user=; path=/; max-age=0';
});

// jsdom lacks ImageData.
if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
    constructor(w: number, h: number);
    constructor(data: Uint8ClampedArray, w: number, h?: number);
    constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
      if (typeof a === 'number') {
        this.width = a;
        this.height = b;
        this.data = new Uint8ClampedArray(a * b * 4);
      } else {
        this.width = b;
        this.height = c ?? a.length / 4 / b;
        this.data = a;
      }
    }
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = ImageDataPolyfill;
}
