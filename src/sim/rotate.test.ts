import { describe, expect, it } from 'vitest';
import { paintRow, rotateCW } from './rotate';

function makePortrait(): ImageData {
  const p = new ImageData(240, 320);
  for (let i = 0; i < p.data.length; i++) p.data[i] = (i * 7 + (i >> 8)) & 255;
  return p;
}

describe('rotate', () => {
  it('maps portrait (5,10) to landscape (309,5)', () => {
    const p = makePortrait();
    const l = rotateCW(p);
    expect(l.width).toBe(320);
    expect(l.height).toBe(240);
    const src = (10 * 240 + 5) * 4;
    const dst = (5 * 320 + 309) * 4;
    expect(Array.from(l.data.slice(dst, dst + 4))).toEqual(Array.from(p.data.slice(src, src + 4)));
  });

  it('paintRow of every landscape row reproduces the portrait', () => {
    const p = makePortrait();
    const l = rotateCW(p);
    const blank = new ImageData(240, 320);
    for (let i = 0; i < 240; i++) {
      paintRow(blank, i, l.data.slice(i * 320 * 4, (i + 1) * 320 * 4));
    }
    expect(Array.from(blank.data)).toEqual(Array.from(p.data));
  });
});
