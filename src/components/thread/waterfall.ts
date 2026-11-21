// Canvas side of the receiving-text spectrogram: paces columns (live FFT frames, or synthetic
// two-tone ones) onto a right-to-left scrolling waterfall. Each animation frame shifts what is
// there left and writes only the new strip; buffers are reused, so frames do not allocate.

import { GRID, SynthFsk, buildColorMap } from './spectrum';
import type { Rgb } from './spectrum';

/** Without live mic columns for this long, simulated columns take over. */
export const LIVE_TIMEOUT_MS = 300;
/** Scroll speed in CSS px per second (~1.4 s of history across 320 px; a bit is ~2 px). */
const SPEED = 220;
const CALM_SPEED = 60;
/** Live frames buffered (~2.7 s at 187.5 frames/s); older ones are dropped. */
const QUEUE = 512;
/** Never draw more than this far behind the newest live frame. */
const MAX_LAG_S = 0.25;
const SYNTH_FPS = 187.5;

type Mode = 'live' | 'synth' | 'wait';

export class SpectrogramView {
  private ctx: CanvasRenderingContext2D | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private strip: ImageData | null = null;
  private strip32 = new Uint32Array(0);
  private stripCols = 0;
  private row0 = new Uint16Array(0);
  private rowFrac = new Float32Array(0);
  private readonly lut = new Uint32Array(256);

  private readonly queue = new Float32Array(QUEUE * GRID);
  private qHead = 0;
  private qLen = 0;
  private liveFps = SYNTH_FPS;
  private lastLiveAt = -Infinity;

  private readonly synth: SynthFsk;
  private readonly col = new Float32Array(GRID);
  private readonly merged = new Float32Array(GRID);
  private mergedCount = 0;
  private pxAcc = 0;
  private budget = 0;
  private mode: Mode = 'wait';
  private last: number | null = null;
  private calm = false;
  private simulated = false;
  private readonly startedAt: number;

  constructor(private readonly canvas: HTMLCanvasElement, now = performance.now()) {
    this.startedAt = now;
    this.synth = new SynthFsk(SYNTH_FPS);
    buildColorMap([15, 173, 255], [255, 255, 255], this.lut);
  }

  /** A receive that is only being simulated: draw synthetic columns straight away. */
  setSimulated(simulated: boolean) {
    this.simulated = simulated;
  }

  /** prefers-reduced-motion: slower scroll, no flicker. */
  setCalm(calm: boolean) {
    this.calm = calm;
    this.synth.setCalm(calm);
  }

  setColors(tone: Rgb, text: Rgb) {
    buildColorMap(tone, text, this.lut);
  }

  /** Normalises any CSS colour through the canvas (null until the canvas has a size). */
  cssColor(value: string): string | null {
    if (!this.ctx || !value) return null;
    this.ctx.fillStyle = '#000';
    this.ctx.fillStyle = value;
    return String(this.ctx.fillStyle);
  }

  /** Sizes the backing store to the element (device pixels). The canvas clears on a change. */
  resize(cssW: number, cssH: number, dpr: number) {
    const w = Math.max(0, Math.round(cssW * dpr));
    const h = Math.max(0, Math.round(cssH * dpr));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = w;
    this.canvas.height = h;
    this.stripCols = 0;
    if (!w || !h) return;
    this.ctx ??= this.canvas.getContext('2d');
    if (!this.ctx) return;
    this.strip = this.ctx.createImageData(w, h);
    this.strip32 = new Uint32Array(this.strip.data.buffer);
    this.row0 = new Uint16Array(h);
    this.rowFrac = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      const g = ((y + 0.5) / h) * (GRID - 1);
      const g0 = Math.min(GRID - 2, Math.floor(g));
      this.row0[y] = g0;
      this.rowFrac[y] = g - g0;
    }
  }

  /** One live FFT column (copied). */
  pushLive(col: Float32Array, framesPerSecond: number, now = performance.now()) {
    this.liveFps = framesPerSecond;
    this.lastLiveAt = now;
    if (this.qLen === QUEUE) {
      this.qHead = (this.qHead + 1) % QUEUE;
      this.qLen--;
    }
    this.queue.set(col, ((this.qHead + this.qLen) % QUEUE) * GRID);
    this.qLen++;
  }

  private pickMode(now: number): Mode {
    if (this.simulated) return 'synth';
    if (now - this.lastLiveAt < LIVE_TIMEOUT_MS) return 'live';
    // Give a real receive a moment to deliver its first chunk before inventing anything.
    return now - this.startedAt < LIVE_TIMEOUT_MS ? 'wait' : 'synth';
  }

  /** Advances the waterfall to `now` (ms, rAF clock). */
  tick(now: number) {
    const dt = this.last === null ? 0 : Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const mode = this.pickMode(now);
    if (mode !== this.mode) {
      this.mode = mode;
      this.budget = 0;
      if (mode === 'synth') this.qLen = 0;
    }
    if (mode === 'wait') return;

    if (mode === 'synth') {
      this.budget += dt * SYNTH_FPS;
      const n = Math.floor(this.budget);
      this.budget -= n;
      for (let i = 0; i < n; i++) {
        this.synth.next(this.col);
        this.addFrame(this.col, SYNTH_FPS);
      }
    } else {
      this.budget += dt * this.liveFps;
      const maxLag = this.liveFps * MAX_LAG_S;
      if (this.qLen - this.budget > maxLag) this.budget = this.qLen - maxLag;
      const n = Math.min(Math.floor(this.budget), this.qLen);
      this.budget -= n;
      // Waiting on the next chunk: allow a little catch-up, not a burst.
      if (this.qLen === n) this.budget = Math.min(this.budget, this.liveFps * 0.05);
      for (let i = 0; i < n; i++) {
        this.addFrame(this.queue.subarray(this.qHead * GRID, (this.qHead + 1) * GRID), this.liveFps);
        this.qHead = (this.qHead + 1) % QUEUE;
        this.qLen--;
      }
    }
    this.flush();
  }

  /** One analysis frame: merged (max) into the next pixel column until enough time has passed. */
  private addFrame(col: Float32Array, fps: number) {
    if (!this.strip) return;
    const { merged } = this;
    if (this.mergedCount === 0) merged.set(col);
    else for (let r = 0; r < GRID; r++) if (col[r] > merged[r]) merged[r] = col[r];
    this.mergedCount++;
    this.pxAcc += ((this.calm ? CALM_SPEED : SPEED) * this.dpr) / fps;
    let k = Math.floor(this.pxAcc);
    if (k === 0) return;
    this.pxAcc -= k;
    this.mergedCount = 0;
    while (k-- > 0) {
      if (this.stripCols === this.w) this.flush();
      this.writeColumn(merged, this.stripCols++);
    }
  }

  private writeColumn(col: Float32Array, x: number) {
    const { w, h, row0, rowFrac, lut, strip32 } = this;
    for (let y = 0, i = x; y < h; y++, i += w) {
      const g = row0[y];
      const v = col[g] + (col[g + 1] - col[g]) * rowFrac[y];
      strip32[i] = lut[(v * 255) | 0];
    }
  }

  /** Shifts the picture left by the new columns and draws them at the right edge. */
  private flush() {
    const { ctx, strip, w, h } = this;
    const p = this.stripCols;
    if (!ctx || !strip || p === 0) return;
    if (p < w) {
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(this.canvas, p, 0, w - p, h, 0, 0, w - p, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.putImageData(strip, w - p, 0, 0, 0, p, h);
    this.stripCols = 0;
  }
}
