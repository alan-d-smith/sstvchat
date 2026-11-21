import { describe, expect, it, vi } from 'vitest';
import { FSK } from '../../audio/fsk';
import { ColumnAnalyser, Fft, GRID, SynthFsk, buildColorMap, hzToTop, magnitudeSpectrum, parseRgb } from './spectrum';
import { SpectrogramView } from './waterfall';

const sine = (hz: number, rate: number, n: number, amp = 1) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

const argmax = (a: ArrayLike<number>) => {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
};

/** Grid row a frequency falls on (row 0 = top = 3000 Hz). */
const rowOf = (hz: number) => Math.round(hzToTop(hz) * (GRID - 1));

describe('Fft', () => {
  it('puts a 1200 Hz sine in the nearest bin', () => {
    for (const [rate, n] of [[48000, 512], [44100, 1024], [8000, 256]] as const) {
      const mags = magnitudeSpectrum(sine(1200, rate, n));
      expect(argmax(mags)).toBe(Math.round((1200 * n) / rate));
    }
  });

  it('reads 1 for a full-scale sine on a bin centre', () => {
    const n = 512;
    const rate = 48000;
    const bin = 25; // 2343.75 Hz
    const mags = magnitudeSpectrum(sine((bin * rate) / n, rate, n));
    expect(argmax(mags)).toBe(bin);
    expect(mags[bin]).toBeCloseTo(1, 2);
  });

  it('matches a direct DFT on random input', () => {
    const n = 64;
    const x = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 1.7) + 0.3 * Math.cos(i * 0.4));
    const re = Float32Array.from(x);
    const im = new Float32Array(n);
    new Fft(n).transform(re, im);
    for (const k of [0, 1, 5, 17, 32, 50]) {
      let dr = 0;
      let di = 0;
      for (let t = 0; t < n; t++) {
        dr += x[t] * Math.cos((2 * Math.PI * k * t) / n);
        di -= x[t] * Math.sin((2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(dr, 3);
      expect(im[k]).toBeCloseTo(di, 3);
    }
  });

  it('rejects sizes that are not a power of two', () => {
    expect(() => new Fft(500)).toThrow();
  });
});

describe('ColumnAnalyser', () => {
  it('emits one column per hop with the tone on its row', () => {
    const rate = 48000;
    const cols: Float32Array[] = [];
    const a = new ColumnAnalyser(rate, (c) => cols.push(c.slice()));
    expect(a.framesPerSecond).toBe(rate / 256);
    // Chunks of the engine's size: 4 × 2048 samples → (8192 - 512) / 256 + 1 frames.
    const tone = sine(FSK.mark, rate, 8192, 0.3);
    for (let i = 0; i < 4; i++) a.push(tone.subarray(i * 2048, (i + 1) * 2048));
    expect(cols).toHaveLength(31);
    const last = cols[cols.length - 1];
    expect(Math.abs(argmax(last) - rowOf(FSK.mark))).toBeLessThanOrEqual(1);
    expect(last[argmax(last)]).toBe(1);
    expect(last[rowOf(FSK.space)]).toBeLessThan(0.3);
  });
});

describe('SynthFsk', () => {
  it('only lights up the mark and space tones', () => {
    const s = new SynthFsk(187.5, true);
    const col = new Float32Array(GRID);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      s.next(col);
      seen.add(argmax(col));
      expect(col[rowOf(500)]).toBeLessThan(0.2);
      expect(col[rowOf(3000)]).toBeLessThan(0.2);
    }
    const near = (row: number, hz: number) => Math.abs(row - rowOf(hz)) <= 1;
    for (const row of seen) expect(near(row, FSK.mark) || near(row, FSK.space)).toBe(true);
    expect([...seen].some((r) => near(r, FSK.mark))).toBe(true);
    expect([...seen].some((r) => near(r, FSK.space))).toBe(true);
  });
});

describe('colour map', () => {
  it('runs from transparent to opaque', () => {
    const lut = buildColorMap([255, 0, 0], [255, 255, 255]);
    const bytes = new Uint8ClampedArray(lut.buffer);
    expect(bytes[3]).toBe(0);
    expect(bytes[255 * 4 + 3]).toBe(255);
  });

  it('parses canvas-normalised colours', () => {
    expect(parseRgb('#0fadff')).toEqual([15, 173, 255]);
    expect(parseRgb('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3]);
    expect(parseRgb('nope')).toBeNull();
  });
});

describe('SpectrogramView', () => {
  function fakeCanvas() {
    const ctx = {
      globalCompositeOperation: 'source-over',
      fillStyle: '#000',
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      drawImage: vi.fn(),
      putImageData: vi.fn(),
    };
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as never);
    return { canvas, ctx };
  }

  it('scrolls simulated columns in from the right at device resolution', () => {
    const { canvas, ctx } = fakeCanvas();
    const view = new SpectrogramView(canvas, 0);
    view.resize(320, 128, 2);
    expect([canvas.width, canvas.height]).toEqual([640, 256]);
    view.setSimulated(true);
    view.tick(0);
    view.tick(50);
    // 50 ms at 220 CSS px/s × 2 → ~22 device columns, drawn at the right edge after a shift left.
    const [, x, , , , p] = ctx.putImageData.mock.calls.at(-1)!;
    expect(p).toBeGreaterThanOrEqual(20);
    expect(p).toBeLessThanOrEqual(22);
    expect(x).toBe(640 - p);
    expect(ctx.drawImage).toHaveBeenCalledWith(canvas, p, 0, 640 - p, 256, 0, 0, 640 - p, 256);
  });

  it('waits briefly for live audio before inventing any', () => {
    const { canvas, ctx } = fakeCanvas();
    const view = new SpectrogramView(canvas, 0);
    view.resize(100, 100, 1);
    view.tick(0);
    view.tick(100);
    expect(ctx.putImageData).not.toHaveBeenCalled();
    // Live columns arrive: they are drawn.
    const col = new Float32Array(GRID).fill(0.5);
    for (let i = 0; i < 20; i++) view.pushLive(col, 187.5, 120);
    view.tick(150);
    expect(ctx.putImageData).toHaveBeenCalled();
    // Then silence for longer than the timeout: synthetic columns keep it moving.
    ctx.putImageData.mockClear();
    view.tick(500);
    view.tick(550);
    expect(ctx.putImageData).toHaveBeenCalled();
  });
});
