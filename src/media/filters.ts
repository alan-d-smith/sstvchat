/**
 * Snap filters: original per-pixel effects shared by the live viewfinder, the shutter and gallery
 * imports, so the preview is exactly what gets sent.
 *
 * Every filter is a pure function of (source pixels, time): it reads `src`, writes every pixel of
 * `dst` (same size, opaque) and never touches `src`. Scratch memory is pooled at module level, so
 * running a filter every frame allocates nothing.
 */

export type SnapFilter =
  | 'none' | 'mono' | 'warm' | 'scanline' | 'thermal' | 'pixel'
  | 'comic' | 'glitch' | 'duotone' | 'halftone' | 'mirror' | 'vapor';

/** Reads `src`, writes all of `dst` (same size, alpha 255). `t` is seconds, for animated effects. */
export type PixelFn = (src: ImageData, dst: ImageData, t: number) => void;

export interface FilterDef {
  id: SnapFilter;
  label: string;
  /** CSS `background` for the lens circle in the carousel. */
  swatch: string;
  apply: PixelFn;
  /** Changes with `t`; the viewfinder holds it still for prefers-reduced-motion. */
  animated?: boolean;
  /** Hard-edged output: scale it up without smoothing. */
  crisp?: boolean;
  /** CSS `filter` equivalent, for showing the plain video when there is no 2D canvas. */
  css?: string;
}

/* ---------- shared helpers ---------- */

/** Rec. 709 luma in 0–255 (weights ×256: 54 + 183 + 19). */
const luma = (d: Uint8ClampedArray, i: number) => (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8;

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Integer hash (lowbias32): a well-mixed 32-bit value for any integer. */
function hash32(n: number): number {
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
}

/** A deterministic random number in [0, 1) for (seed, k). */
const rand = (seed: number, k: number) => hash32(Math.imul(seed, 0x9e3779b1) + k) / 4294967296;

const u8Pool: Uint8Array[] = [];
const i32Pool: Int32Array[] = [];
const f32Pool: Float32Array[] = [];

/** Pooled scratch buffers (at least n long; contents undefined). Slots are per call site. */
function u8(slot: number, n: number): Uint8Array {
  const b = u8Pool[slot];
  return b && b.length >= n ? b : (u8Pool[slot] = new Uint8Array(n));
}
function i32(slot: number, n: number): Int32Array {
  const b = i32Pool[slot];
  return b && b.length >= n ? b : (i32Pool[slot] = new Int32Array(n));
}
function f32(slot: number, n: number): Float32Array {
  const b = f32Pool[slot];
  return b && b.length >= n ? b : (f32Pool[slot] = new Float32Array(n));
}

/** A 256-entry RGB lookup table along colour stops ([position 0–1, 0xRRGGBB], ascending). */
function ramp(stops: readonly (readonly [number, number])[]): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let v = 0; v < 256; v++) {
    const p = v / 255;
    let k = 0;
    while (k < stops.length - 2 && p > stops[k + 1][0]) k++;
    const [p0, c0] = stops[k];
    const [p1, c1] = stops[k + 1];
    const f = Math.min(1, Math.max(0, (p - p0) / (p1 - p0)));
    for (let ch = 0; ch < 3; ch++) {
      const shift = 16 - ch * 8;
      const a = (c0 >> shift) & 255;
      const b = (c1 >> shift) & 255;
      lut[v * 3 + ch] = Math.round(a + (b - a) * f);
    }
  }
  return lut;
}

/** Luma of every pixel into a pooled buffer. */
function lumaPlane(src: ImageData, slot: number): Uint8Array {
  const n = src.width * src.height;
  const s = src.data;
  const out = u8(slot, n);
  for (let p = 0, i = 0; p < n; p++, i += 4) out[p] = luma(s, i);
  return out;
}

/** In-place [1 2 1] × [1 2 1] blur of a w×h plane (edges clamped), via `tmp`. */
function blur(a: Uint8Array, tmp: Uint8Array, w: number, h: number) {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const l = a[row + (x > 0 ? x - 1 : 0)];
      const r = a[row + (x < w - 1 ? x + 1 : x)];
      tmp[row + x] = (l + 2 * a[row + x] + r + 2) >> 2;
    }
  }
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : 0) * w;
    const row = y * w;
    const dn = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) a[row + x] = (tmp[up + x] + 2 * tmp[row + x] + tmp[dn + x] + 2) >> 2;
  }
}

/** A [1 2 1] × [1 2 1] blur of the RGB channels into a pooled RGBA-strided buffer (alpha unset). */
function blurRgb(s: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const n4 = w * h * 4;
  const tmp = u8(3, n4);
  const out = u8(4, n4);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const o = row + x * 4;
      const l = row + (x > 0 ? x - 1 : 0) * 4;
      const r = row + (x < w - 1 ? x + 1 : x) * 4;
      tmp[o] = (s[l] + 2 * s[o] + s[r] + 2) >> 2;
      tmp[o + 1] = (s[l + 1] + 2 * s[o + 1] + s[r + 1] + 2) >> 2;
      tmp[o + 2] = (s[l + 2] + 2 * s[o + 2] + s[r + 2] + 2) >> 2;
    }
  }
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : 0) * stride;
    const row = y * stride;
    const dn = (y < h - 1 ? y + 1 : y) * stride;
    for (let i = 0; i < stride; i += 4) {
      out[row + i] = (tmp[up + i] + 2 * tmp[row + i] + tmp[dn + i] + 2) >> 2;
      out[row + i + 1] = (tmp[up + i + 1] + 2 * tmp[row + i + 1] + tmp[dn + i + 1] + 2) >> 2;
      out[row + i + 2] = (tmp[up + i + 2] + 2 * tmp[row + i + 2] + tmp[dn + i + 2] + 2) >> 2;
    }
  }
  return out;
}

/** Writes lut[curve[luma]] for every pixel. */
function mapLuma(src: ImageData, dst: ImageData, lut: Uint8Array, curve: Uint8Array) {
  const s = src.data;
  const d = dst.data;
  for (let i = 0; i < s.length; i += 4) {
    const k = curve[luma(s, i)] * 3;
    d[i] = lut[k];
    d[i + 1] = lut[k + 1];
    d[i + 2] = lut[k + 2];
    d[i + 3] = 255;
  }
}

const IDENTITY = Uint8Array.from({ length: 256 }, (_, v) => v);

/* ---------- Normal, Mono, Warm: the CSS colour recipes, done per pixel ---------- */

type Op = readonly ['grayscale' | 'sepia' | 'saturate' | 'contrast' | 'brightness', number];

/** An op as a 3×3 matrix plus offset in 0–255 space (the Filter Effects definitions). */
function opAffine([fn, v]: Op): number[] {
  const a = 1 - v;
  switch (fn) {
    case 'grayscale':
      return [
        0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a,
        0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a,
        0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a,
        0, 0, 0,
      ];
    case 'sepia':
      return [
        0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a,
        0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a,
        0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a,
        0, 0, 0,
      ];
    case 'saturate':
      return [
        0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v,
        0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v,
        0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v,
        0, 0, 0,
      ];
    case 'contrast': {
      const off = (0.5 - 0.5 * v) * 255;
      return [v, 0, 0, 0, v, 0, 0, 0, v, off, off, off];
    }
    case 'brightness':
      return [v, 0, 0, 0, v, 0, 0, 0, v, 0, 0, 0];
  }
}

/** A filter that runs CSS-style colour ops in order, clamping after each like the browser does. */
function colourOps(ops: readonly Op[]): { apply: PixelFn; css: string } {
  const m = Float64Array.from(ops.flatMap(opAffine));
  const apply: PixelFn = (src, dst) => {
    const s = src.data;
    const d = dst.data;
    for (let i = 0; i < s.length; i += 4) {
      let r = s[i];
      let g = s[i + 1];
      let b = s[i + 2];
      for (let k = 0; k < m.length; k += 12) {
        const nr = m[k] * r + m[k + 1] * g + m[k + 2] * b + m[k + 9];
        const ng = m[k + 3] * r + m[k + 4] * g + m[k + 5] * b + m[k + 10];
        const nb = m[k + 6] * r + m[k + 7] * g + m[k + 8] * b + m[k + 11];
        r = clamp8(nr);
        g = clamp8(ng);
        b = clamp8(nb);
      }
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  };
  return { apply, css: ops.map(([fn, v]) => `${fn}(${v})`).join(' ') };
}

const copy: PixelFn = (src, dst) => {
  dst.data.set(src.data);
  const d = dst.data;
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
};

const mono = colourOps([['grayscale', 1], ['contrast', 1.15]]);
const warm = colourOps([['sepia', 0.5], ['saturate', 1.25], ['brightness', 1.04]]);

/* ---------- Scanline: an SSTV monitor — CRT lines, colour bleed, grain and a slow scan bar ---------- */

const scanline: PixelFn = (src, dst, t) => {
  const { width: w, height: h } = src;
  const s = src.data;
  const d = dst.data;
  const rowGain = f32(0, h);
  const colGain = f32(1, w);
  // A soft bright band sweeps down every ~5 s, like a picture being painted line by line.
  const bar = ((t * 0.24) % 1.3 - 0.15) * h;
  const barW = h / 12;
  for (let y = 0; y < h; y++) {
    const phase = y % 3;
    const line = phase === 2 ? 0.56 : phase === 0 ? 1.08 : 1;
    const dy = (y - bar) / barW;
    const vy = h > 1 ? (y / (h - 1)) * 2 - 1 : 0;
    rowGain[y] = line * (1 + 0.2 * Math.exp(-dy * dy)) * (1 - 0.2 * vy * vy);
  }
  for (let x = 0; x < w; x++) {
    const vx = w > 1 ? (x / (w - 1)) * 2 - 1 : 0;
    colGain[x] = 1 - 0.16 * vx * vx;
  }
  const seed = Math.floor(t * 24);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const rg = rowGain[y];
    for (let x = 0; x < w; x++) {
      const o = (row + x) * 4;
      // Red trails two pixels behind, blue runs one ahead: the smeared chroma of an analogue picture.
      const l = (row + (x > 1 ? x - 2 : 0)) * 4;
      const r = (row + (x < w - 1 ? x + 1 : x)) * 4;
      const g = rg * colGain[x];
      const n = (hash32((row + x) ^ Math.imul(seed, 0x2c1b3c6d)) & 31) - 16;
      d[o] = ((s[l] + s[o]) >> 1) * g + n;
      d[o + 1] = s[o + 1] * g * 1.03 + n;
      d[o + 2] = ((s[o + 2] + s[r + 2]) >> 1) * g + n;
      d[o + 3] = 255;
    }
  }
};

/* ---------- Thermal: a false-colour heat map of brightness ---------- */

const THERMAL = ramp([
  [0, 0x000000], [0.18, 0x2a0b63], [0.38, 0x8e1a8f], [0.56, 0xe8322a],
  [0.74, 0xff9a00], [0.88, 0xffe94a], [1, 0xffffff],
]);

/** The level of the `rank`-th darkest pixel in a 256-bin histogram. */
function percentile(hist: Int32Array, rank: number) {
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc > rank) return v;
  }
  return 255;
}

const thermal: PixelFn = (src, dst) => {
  const { width: w, height: h } = src;
  const n = w * h;
  const lum = lumaPlane(src, 0);
  // Heat spreads: two soft blurs.
  const tmp = u8(1, n);
  blur(lum, tmp, w, h);
  blur(lum, tmp, w, h);
  // Stretch the middle 96% of the levels over the palette so the scene always spans cold → hot.
  const hist = i32(0, 256).fill(0, 0, 256);
  for (let p = 0; p < n; p++) hist[lum[p]]++;
  const lo = percentile(hist, n * 0.02);
  const hi = percentile(hist, n * 0.98);
  const curve = u8(2, 256);
  for (let v = 0; v < 256; v++) curve[v] = hi - lo >= 48 ? clamp8(((v - lo) * 255) / (hi - lo)) : v;
  const d = dst.data;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const k = curve[lum[p]] * 3;
    d[i] = THERMAL[k];
    d[i + 1] = THERMAL[k + 1];
    d[i + 2] = THERMAL[k + 2];
    d[i + 3] = 255;
  }
};

/* ---------- Pixel: chunky 8-bit blocks in a 125-colour palette ---------- */

export const PIXEL_BLOCK = 8;
/** Five levels per channel: 0, 64, 128, 191, 255. */
const LEVEL5 = Uint8Array.from({ length: 256 }, (_, v) => Math.round(Math.round(v / 63.75) * 63.75));

const pixel: PixelFn = (src, dst) => {
  const { width: w, height: h } = src;
  const s = src.data;
  const d = dst.data;
  const B = PIXEL_BLOCK;
  for (let by = 0; by < h; by += B) {
    const bh = Math.min(B, h - by);
    for (let bx = 0; bx < w; bx += B) {
      const bw = Math.min(B, w - bx);
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = by; y < by + bh; y++) {
        for (let i = (y * w + bx) * 4, e = i + bw * 4; i < e; i += 4) {
          r += s[i];
          g += s[i + 1];
          b += s[i + 2];
        }
      }
      const k = bw * bh;
      r /= k;
      g /= k;
      b /= k;
      // A little extra saturation keeps the reduced palette colourful rather than muddy.
      const y0 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const R = LEVEL5[clamp8(y0 + (r - y0) * 1.3) | 0];
      const G = LEVEL5[clamp8(y0 + (g - y0) * 1.3) | 0];
      const Bl = LEVEL5[clamp8(y0 + (b - y0) * 1.3) | 0];
      for (let y = by; y < by + bh; y++) {
        for (let i = (y * w + bx) * 4, e = i + bw * 4; i < e; i += 4) {
          d[i] = R;
          d[i + 1] = G;
          d[i + 2] = Bl;
          d[i + 3] = 255;
        }
      }
    }
  }
};

/* ---------- Comic: cel-shaded tones with inked edges ---------- */

/**
 * Four flat light levels. Each step eases over 12 luma levels, so a flat area that sits right on
 * a step shades evenly instead of speckling between two bands with the sensor noise.
 */
const BANDS = Uint8Array.from({ length: 256 }, (_, v) => {
  const levels = [36, 104, 172, 240];
  let out = levels[0];
  for (let k = 1; k < levels.length; k++) {
    const x = Math.min(1, Math.max(0, (v - (k * 64 - 6)) / 12));
    out += (levels[k] - levels[k - 1]) * x * x * (3 - 2 * x);
  }
  return Math.round(out);
});
const INK = [22, 18, 34] as const;
/** Edge strength (|Sobel x| + |Sobel y| of the softened luma) where ink starts, and where it is solid. */
const INK_FROM = 90;
const INK_FULL = 220;

const comic: PixelFn = (src, dst) => {
  const { width: w, height: h } = src;
  const n = w * h;
  const d = dst.data;
  // Softened first, so sensor noise neither draws stray ink nor speckles the tones.
  const s = blurRgb(src.data, w, h);
  const lum = u8(0, n);
  const tone = u8(1, n);
  for (let p = 0, i = 0; p < n; p++, i += 4) lum[p] = tone[p] = (s[i] * 54 + s[i + 1] * 183 + s[i + 2] * 19) >> 8;
  // The light bands follow an even softer copy, so their borders are clean curves.
  const tmp = u8(2, n);
  blur(tone, tmp, w, h);
  blur(tone, tmp, w, h);
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : 0) * w;
    const row = y * w;
    const dn = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : 0;
      const xr = x < w - 1 ? x + 1 : x;
      const tl = lum[up + xl];
      const tr = lum[up + xr];
      const bl = lum[dn + xl];
      const br = lum[dn + xr];
      const gx = tr + 2 * lum[row + xr] + br - tl - 2 * lum[row + xl] - bl;
      const gy = bl + 2 * lum[dn + x] + br - tl - 2 * lum[up + x] - tr;
      const mag = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
      const ink = mag <= INK_FROM ? 0 : mag >= INK_FULL ? 1 : (mag - INK_FROM) / (INK_FULL - INK_FROM);

      const o = (row + x) * 4;
      const yl = lum[row + x];
      // Richer colour, with its brightness moved onto one of the flat bands.
      const band = BANDS[tone[row + x]];
      const pr = clamp8(band + (s[o] - yl) * 1.5);
      const pg = clamp8(band + (s[o + 1] - yl) * 1.5);
      const pb = clamp8(band + (s[o + 2] - yl) * 1.5);
      d[o] = pr + (INK[0] - pr) * ink;
      d[o + 1] = pg + (INK[1] - pg) * ink;
      d[o + 2] = pb + (INK[2] - pb) * ink;
      d[o + 3] = 255;
    }
  }
};

/* ---------- Glitch: RGB channel split and torn horizontal slices ---------- */

const glitch: PixelFn = (src, dst, t) => {
  const { width: w, height: h } = src;
  const s = src.data;
  const d = dst.data;
  const tick = Math.floor(t * 8);
  // Channels drift apart a little, with an occasional burst.
  const split = Math.max(1, Math.round(w / 90)) + (rand(tick, 0) < 0.18 ? Math.round(w / 30) : 0);

  const rowOff = i32(0, h).fill(0, 0, h);
  const rowSwap = u8(0, h).fill(0, 0, h);
  const slices = rand(tick, 1) < 0.7 ? 1 + Math.floor(rand(tick, 2) * 4) : 0;
  for (let k = 0; k < slices; k++) {
    const y0 = Math.floor(rand(tick, 10 + k) * h);
    const y1 = Math.min(h, y0 + 2 + Math.floor((rand(tick, 20 + k) * h) / 9));
    const off = Math.round((rand(tick, 30 + k) * 2 - 1) * (w / 5));
    const swap = rand(tick, 40 + k) < 0.35 ? 1 : 0;
    for (let y = y0; y < y1; y++) {
      rowOff[y] += off;
      rowSwap[y] |= swap;
    }
  }

  for (let y = 0; y < h; y++) {
    const row = y * w;
    const off = rowOff[y];
    const swap = rowSwap[y];
    for (let x = 0; x < w; x++) {
      const sx = (((x - off) % w) + w) % w;
      const ri = (row + (sx + split < w ? sx + split : w - 1)) * 4;
      const gi = (row + sx) * 4;
      const bi = (row + (sx - split >= 0 ? sx - split : 0)) * 4;
      const o = (row + x) * 4;
      if (swap) {
        d[o] = s[bi + 2];
        d[o + 1] = s[ri];
        d[o + 2] = s[gi + 1];
      } else {
        d[o] = s[ri];
        d[o + 1] = s[gi + 1];
        d[o + 2] = s[bi + 2];
      }
      d[o + 3] = 255;
    }
  }
};

/* ---------- Duotone: shadows in deep blue, highlights in the brand yellow ---------- */

export const DUO_SHADOW = 0x14185c;
export const DUO_LIGHT = 0xfffc00;
const DUOTONE = ramp([[0, DUO_SHADOW], [1, DUO_LIGHT]]);
/** A soft step from 0 to 1 centred on luma `m`, about 30 levels wide. */
const split = (v: number, m: number) => 1 / (1 + Math.exp((m - v) / 30));

/** Otsu's threshold: the level that best separates a histogram into a dark and a light group. */
function otsu(hist: Int32Array, n: number): number {
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let below = 0;
  let sumBelow = 0;
  let best = -1;
  let level = 127.5;
  for (let v = 0; v < 255; v++) {
    below += hist[v];
    sumBelow += v * hist[v];
    const above = n - below;
    if (!below || !above) continue;
    const gap = sumBelow / below - (sum - sumBelow) / above;
    const score = below * above * gap * gap;
    if (score > best) {
      best = score;
      level = v + 0.5;
    }
  }
  return level;
}

const duotone: PixelFn = (src, dst) => {
  const s = src.data;
  const hist = i32(0, 256).fill(0, 0, 256);
  for (let i = 0; i < s.length; i += 4) hist[luma(s, i)]++;
  // Split the tones where this frame's dark and light parts separate (hair and clothes from skin
  // and sky, say), so each part takes one ink and few pixels sit in the muddy middle, whatever
  // the exposure. 0 and 255 stay the pure inks.
  const m = otsu(hist, src.width * src.height);
  const lo = split(0, m);
  const span = split(255, m) - lo;
  const curve = u8(2, 256);
  for (let v = 0; v < 256; v++) curve[v] = Math.round(255 * (0.2 * (v / 255) + (0.8 * (split(v, m) - lo)) / span));
  mapLuma(src, dst, DUOTONE, curve);
};

/* ---------- Vapor: a pink-violet-cyan gradient map ---------- */

const VAPOR = ramp([
  [0, 0x1b0b3a], [0.3, 0x6b2fd0], [0.58, 0xff4fa3], [0.82, 0x52e6ff], [1, 0xeefcff],
]);

const vapor: PixelFn = (src, dst) => mapLuma(src, dst, VAPOR, IDENTITY);

/* ---------- Halftone: coloured print dots on paper, bigger where darker ---------- */

export const HALFTONE_CELL = 6;
export const PAPER = [250, 245, 232] as const;

const halftone: PixelFn = (src, dst) => {
  const { width: w, height: h } = src;
  const s = src.data;
  const d = dst.data;
  const C = HALFTONE_CELL;
  const half = C / 2;
  // Hexagonal grid: odd rows of cells shift half a cell, so there is one extra cell per row.
  const cols = Math.ceil(w / C) + 1;
  const rows = Math.ceil(h / C);
  const cells = f32(0, cols * rows * 4);

  for (let cy = 0; cy < rows; cy++) {
    const shift = cy & 1 ? half : 0;
    const y0 = cy * C;
    const y1 = Math.min(h, y0 + C);
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.max(0, cx * C - shift);
      const x1 = Math.min(w, cx * C - shift + C);
      const c = (cy * cols + cx) * 4;
      if (x1 <= x0) {
        cells[c + 3] = 0;
        continue;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = y0; y < y1; y++) {
        for (let i = (y * w + x0) * 4, e = (y * w + x1) * 4; i < e; i += 4) {
          r += s[i];
          g += s[i + 1];
          b += s[i + 2];
        }
      }
      const k = (x1 - x0) * (y1 - y0);
      r /= k;
      g /= k;
      b /= k;
      const yl = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // Ink: the cell's colour, richer and darker; dot area grows with darkness.
      cells[c] = clamp8(yl + (r - yl) * 1.5) * 0.82;
      cells[c + 1] = clamp8(yl + (g - yl) * 1.5) * 0.82;
      cells[c + 2] = clamp8(yl + (b - yl) * 1.5) * 0.82;
      cells[c + 3] = C * 0.74 * Math.sqrt(1 - yl / 255);
    }
  }

  for (let y = 0; y < h; y++) {
    const cy = (y / C) | 0;
    const shift = cy & 1 ? half : 0;
    const dy = y - (cy * C + half - 0.5);
    for (let x = 0; x < w; x++) {
      const cx = ((x + shift) / C) | 0;
      const c = (cy * cols + cx) * 4;
      const dx = x - (cx * C - shift + half - 0.5);
      const cover = Math.min(1, Math.max(0, cells[c + 3] - Math.sqrt(dx * dx + dy * dy) + 0.5));
      const o = (y * w + x) * 4;
      d[o] = PAPER[0] + (cells[c] - PAPER[0]) * cover;
      d[o + 1] = PAPER[1] + (cells[c + 1] - PAPER[1]) * cover;
      d[o + 2] = PAPER[2] + (cells[c + 2] - PAPER[2]) * cover;
      d[o + 3] = 255;
    }
  }
};

/* ---------- Mirror: the left half reflected onto the right ---------- */

const mirror: PixelFn = (src, dst) => {
  const { width: w, height: h } = src;
  const s = src.data;
  const d = dst.data;
  const half = Math.ceil(w / 2);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = (row + (x < half ? x : w - 1 - x)) * 4;
      const o = (row + x) * 4;
      d[o] = s[i];
      d[o + 1] = s[i + 1];
      d[o + 2] = s[i + 2];
      d[o + 3] = 255;
    }
  }
};

/* ---------- the registry, in carousel order ---------- */

export const FILTERS: readonly FilterDef[] = [
  { id: 'none', label: 'Normal', swatch: 'none', apply: copy, css: 'none' },
  {
    id: 'mono',
    label: 'Mono',
    swatch: 'radial-gradient(circle at 34% 30%, #fff 0 10%, #c9c9c9 28%, #6d6d6d 62%, #1e1e1e 100%)',
    ...mono,
  },
  {
    id: 'warm',
    label: 'Warm',
    swatch: 'radial-gradient(circle at 34% 30%, #fff6dc 0 10%, #ffcf7d 32%, #e9823f 66%, #93401d 100%)',
    ...warm,
  },
  {
    id: 'scanline',
    label: 'Scanline',
    swatch: 'repeating-linear-gradient(180deg, rgba(8, 6, 20, 0.55) 0 1.5px, transparent 1.5px 4.5px), '
      + 'linear-gradient(180deg, #ffe08a 0%, #ff8f6b 45%, #4a6cff 100%)',
    apply: scanline,
    animated: true,
  },
  {
    id: 'thermal',
    label: 'Thermal',
    swatch: 'radial-gradient(circle at 42% 40%, #fff 0 7%, #ffe94a 16%, #ff9a00 27%, #e8322a 40%, '
      + '#8e1a8f 60%, #2a0b63 80%, #000 100%)',
    apply: thermal,
  },
  {
    id: 'pixel',
    label: 'Pixel',
    swatch: 'repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.2) 0 25%, transparent 0 50%), '
      + 'repeating-linear-gradient(180deg, rgba(255, 255, 255, 0.22) 0 25%, transparent 0 50%), '
      + 'conic-gradient(from 90deg, #3ec1ff 0 25%, #7cdb5a 0 50%, #ffd23f 0 75%, #ff5a8a 0)',
    apply: pixel,
    crisp: true,
  },
  {
    id: 'comic',
    label: 'Comic',
    swatch: 'radial-gradient(circle, rgba(22, 18, 34, 0.8) 0 1.4px, transparent 1.9px) 0 0 / 6px 6px, '
      + 'linear-gradient(135deg, #ffe14d 0 46%, #16121e 46% 54%, #ff4f5e 54%)',
    apply: comic,
  },
  {
    id: 'glitch',
    label: 'Glitch',
    swatch: 'linear-gradient(#ff2d78, #ff2d78) -6px 12px / 70% 4px no-repeat, '
      + 'linear-gradient(#2de2ff, #2de2ff) 14px 24px / 80% 5px no-repeat, '
      + 'linear-gradient(#f4f4ff, #f4f4ff) 6px 33px / 55% 2px no-repeat, '
      + 'linear-gradient(90deg, #4a1838 0 18%, #1b1530 18% 82%, #123a4a 82%)',
    apply: glitch,
    animated: true,
  },
  {
    id: 'duotone',
    label: 'Duotone',
    swatch: 'radial-gradient(circle at 30% 28%, #fffc00 0 20%, #14185c 80%)',
    apply: duotone,
  },
  {
    id: 'halftone',
    label: 'Halftone',
    swatch: 'radial-gradient(circle, #e8365d 0 40%, transparent 47%) 0 0 / 8px 8px, '
      + 'radial-gradient(circle, #e8365d 0 40%, transparent 47%) 4px 4px / 8px 8px, #fbf3df',
    apply: halftone,
  },
  {
    id: 'mirror',
    label: 'Mirror',
    swatch: 'linear-gradient(90deg, transparent calc(50% - 1px), rgba(255, 255, 255, 0.9) calc(50% - 1px) '
      + 'calc(50% + 1px), transparent calc(50% + 1px)), '
      + 'radial-gradient(circle at 24% 50%, #ffd23f 0 13%, transparent 14%), '
      + 'radial-gradient(circle at 76% 50%, #ffd23f 0 13%, transparent 14%), '
      + 'linear-gradient(90deg, #7b5cff, #36d6c3 50%, #7b5cff)',
    apply: mirror,
  },
  {
    id: 'vapor',
    label: 'Vapor',
    swatch: 'radial-gradient(circle at 50% 64%, #ffe1f3 0 22%, transparent 23%), '
      + 'linear-gradient(180deg, #ff5fb4 0%, #9a5cff 55%, #36e2ff 100%)',
    apply: vapor,
  },
];

const BY_ID = new Map(FILTERS.map((f) => [f.id, f]));

export function getFilter(id: SnapFilter): FilterDef {
  return BY_ID.get(id) ?? FILTERS[0];
}
