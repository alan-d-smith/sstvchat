import { describe, expect, it } from 'vitest';
import { DUO_LIGHT, DUO_SHADOW, FILTERS, HALFTONE_CELL, PAPER, PIXEL_BLOCK, getFilter } from './filters';
import type { SnapFilter } from './filters';

type RGB = [number, number, number];

function image(w: number, h: number, px: (x: number, y: number) => RGB): ImageData {
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) img.data.set([...px(x, y), 255], (y * w + x) * 4);
  }
  return img;
}

const flat = (w: number, h: number, c: RGB) => image(w, h, () => c);

/** A busy little test picture: gradients and colour in every channel. */
const scene = () => image(24, 24, (x, y) => [(x * 11 + y * 3) % 256, (y * 10) % 256, ((x ^ y) * 9) % 256]);

function run(id: SnapFilter, src: ImageData, t = 0): ImageData {
  const dst = new ImageData(src.width, src.height);
  getFilter(id).apply(src, dst, t);
  return dst;
}

const at = (img: ImageData, x: number, y: number): RGB => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

const luma = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const hex = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

describe('filter registry', () => {
  it('keeps Normal, Mono and Warm first, then the new effects, each with its own swatch', () => {
    expect(FILTERS.map((f) => f.label)).toEqual([
      'Normal', 'Mono', 'Warm', 'Scanline', 'Thermal', 'Pixel', 'Comic', 'Glitch', 'Duotone', 'Halftone', 'Mirror', 'Vapor',
    ]);
    expect(new Set(FILTERS.map((f) => f.id)).size).toBe(FILTERS.length);
    expect(new Set(FILTERS.map((f) => f.swatch)).size).toBe(FILTERS.length);
    expect(FILTERS.filter((f) => f.animated).map((f) => f.id)).toEqual(['scanline', 'glitch']);
  });

  it.each(FILTERS.map((f) => f.id))('%s is pure, opaque and leaves the source alone', (id) => {
    const src = scene();
    const before = src.data.slice();
    const a = run(id, src, 1.3);
    const b = run(id, src, 1.3);
    expect(src.data).toEqual(before);
    expect(a.data).toEqual(b.data);
    for (let i = 3; i < a.data.length; i += 4) expect(a.data[i]).toBe(255);
  });

  it.each(FILTERS.filter((f) => f.id !== 'none').map((f) => f.id))('%s changes the picture', (id) => {
    const src = scene();
    expect(run(id, src).data).not.toEqual(src.data);
  });
});

describe('filters', () => {
  it('Normal copies the picture', () => {
    const src = scene();
    expect(run('none', src).data).toEqual(src.data);
  });

  it('Mono makes every pixel grey, like grayscale(1) contrast(1.15)', () => {
    const out = run('mono', scene());
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(out.data[i + 1]);
      expect(out.data[i + 1]).toBe(out.data[i + 2]);
    }
    const [r] = at(run('mono', flat(1, 1, [255, 0, 0])), 0, 0);
    expect(r).toBeGreaterThan(35);
    expect(r).toBeLessThan(50);
  });

  it('Warm tints grey towards amber', () => {
    const [r, g, b] = at(run('warm', flat(2, 2, [128, 128, 128])), 0, 0);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('Thermal maps black to dark, white to bright, and brightness up the heat scale', () => {
    expect(luma(at(run('thermal', flat(8, 8, [0, 0, 0])), 3, 3))).toBeLessThan(10);
    const hot = at(run('thermal', flat(8, 8, [255, 255, 255])), 3, 3);
    expect(Math.min(...hot)).toBeGreaterThan(240);

    // A left-to-right grey ramp: the heat colours get brighter all the way, red-hot in the middle.
    const out = run('thermal', image(256, 4, (x) => [x, x, x]));
    const row = Array.from({ length: 256 }, (_, x) => luma(at(out, x, 1)));
    for (let x = 1; x < 256; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1] - 0.5);
    const [r, , b] = at(out, 140, 1);
    expect(r).toBeGreaterThan(b);
    expect(luma(at(out, 5, 1))).toBeLessThan(15);
    expect(luma(at(out, 250, 1))).toBeGreaterThan(240);
  });

  it('Pixel paints uniform 8×8 blocks from a reduced palette', () => {
    const out = run('pixel', image(16, 24, (x, y) => [(x * 37 + y * 11) % 256, (x * 7 + y * 29) % 256, (x * y * 5) % 256]));
    const levels = new Set([0, 64, 128, 191, 255]);
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 16; x++) {
        const px = at(out, x, y);
        expect(px).toEqual(at(out, x - (x % PIXEL_BLOCK), y - (y % PIXEL_BLOCK)));
        px.forEach((v) => expect(levels.has(v)).toBe(true));
      }
    }
  });

  it('Glitch splits the colour channels and tears differently over time', () => {
    // Grey on the left, white on the right: channel split shows as colour fringes at the edge.
    const src = image(40, 30, (x) => (x < 20 ? [40, 40, 40] : [230, 230, 230]));
    const out = run('glitch', src, 0);
    let fringe = 0;
    for (let i = 0; i < out.data.length; i += 4) if (out.data[i] !== out.data[i + 2]) fringe++;
    expect(fringe).toBeGreaterThan(0);

    const frames = new Set([0, 0.13, 0.26, 0.39, 0.52, 0.65].map((t) => run('glitch', src, t).data.join()));
    expect(frames.size).toBeGreaterThan(1);
  });

  it('Mirror reflects the left half onto the right', () => {
    const src = scene();
    const out = run('mirror', src);
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        expect(at(out, x, y)).toEqual(at(out, 23 - x, y));
        if (x < 12) expect(at(out, x, y)).toEqual(at(src, x, y));
      }
    }
  });

  it('Comic flattens colour and inks the edges', () => {
    const plain = run('comic', flat(12, 12, [150, 90, 40]));
    const first = at(plain, 0, 0);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) expect(at(plain, x, y)).toEqual(first);

    const out = run('comic', image(32, 12, (x) => (x < 16 ? [150, 150, 150] : [255, 255, 255])));
    expect(luma(at(out, 15, 6))).toBeLessThan(60);
    expect(luma(at(out, 16, 6))).toBeLessThan(60);
    expect(luma(at(out, 4, 6))).toBeGreaterThan(150);
    expect(luma(at(out, 28, 6))).toBeGreaterThan(230);
  });

  it('Scanline darkens every third line', () => {
    const out = run('scanline', flat(12, 12, [128, 128, 128]));
    for (const y of [0, 3, 6, 9]) {
      expect(luma(at(out, 6, y + 2))).toBeLessThan(luma(at(out, 6, y)) - 25);
      expect(luma(at(out, 6, y + 2))).toBeLessThan(luma(at(out, 6, y + 1)) - 25);
    }
  });

  it('Duotone runs from deep blue in the shadows to yellow in the highlights', () => {
    expect(at(run('duotone', flat(2, 2, [0, 0, 0])), 0, 0)).toEqual(hex(DUO_SHADOW));
    expect(at(run('duotone', flat(2, 2, [255, 255, 255])), 0, 0)).toEqual(hex(DUO_LIGHT));
    // Grey lands between the two inks.
    const [r, , b] = at(run('duotone', flat(2, 2, [128, 128, 128])), 0, 0);
    expect(r).toBeGreaterThan(hex(DUO_SHADOW)[0]);
    expect(r).toBeLessThan(hex(DUO_LIGHT)[0]);
    expect(b).toBeLessThan(hex(DUO_SHADOW)[2]);
  });

  it('Vapor maps shadows to deep violet, mid-tones to pink and highlights to pale cyan', () => {
    expect(luma(at(run('vapor', flat(2, 2, [0, 0, 0])), 0, 0))).toBeLessThan(30);
    const [r, g] = at(run('vapor', flat(2, 2, [150, 150, 150])), 0, 0);
    expect(r).toBeGreaterThan(g);
    const [hr, hg, hb] = at(run('vapor', flat(2, 2, [255, 255, 255])), 0, 0);
    expect(Math.min(hr, hg, hb)).toBeGreaterThan(220);
    expect(hb).toBeGreaterThanOrEqual(hr);
  });

  it('Halftone prints bigger dots where darker, on paper', () => {
    const blank = run('halftone', flat(18, 18, [255, 255, 255]));
    for (let y = 0; y < 18; y++) for (let x = 0; x < 18; x++) expect(at(blank, x, y)).toEqual([...PAPER]);

    const ink = run('halftone', flat(18, 18, [0, 0, 0]));
    for (let y = 0; y < 18; y++) for (let x = 0; x < 18; x++) expect(luma(at(ink, x, y))).toBeLessThan(10);

    // Mid grey: a dot in the middle of each cell, paper showing at its corners.
    const grey = run('halftone', flat(18, 18, [128, 128, 128]));
    const c = HALFTONE_CELL;
    expect(luma(at(grey, c / 2, c / 2))).toBeLessThan(luma(at(grey, 0, 0)) - 80);
  });
});
