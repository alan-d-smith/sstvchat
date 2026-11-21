// Two-tone (binary FSK) modem: mark 3000 Hz = 1, space 4000 Hz = 0, 100 baud, UART framing. The
// tones sit above the speech-dominant band (crowd chatter falls ~7 dB/octave above 1 kHz), where
// phone and laptop speakers are efficient; they stay well under 5 kHz for cheap speakers.
// See docs/superpowers/specs/2026-11-21-audio-transport-design.md ("Two-tone FSK").
import { PacketParser, type PacketEvents } from './packet';

/** The FSK tones, rate and framing: the one place they are defined. */
export const FSK = { mark: 3000, space: 4000, baud: 100, leadInMs: 300, tailMs: 60 } as const;
export interface FskEvents extends PacketEvents {
  onAbort?(): void;
}

/**
 * Noise-floor ("guard") frequencies: half the tone spacing below mark, between the tones and above
 * space, on the baud grid so a steady tone leaks nothing into them over one bit.
 */
export const FSK_GUARD_HZ = (() => {
  const half = Math.max(1, Math.round((FSK.space - FSK.mark) / 2 / FSK.baud)) * FSK.baud;
  return [FSK.mark - half, FSK.mark + half, FSK.space + half];
})();

const FADE_MS = 5;
const BITS_PER_BYTE = 10; // start + 8 data + stop
const TWO_PI = 2 * Math.PI;

/** Duration of `fskModulate` output for `byteCount` bytes. */
export function fskDurationMs(byteCount: number): number {
  return FSK.leadInMs + (byteCount * BITS_PER_BYTE * 1000) / FSK.baud + FSK.tailMs;
}

/**
 * Lead-in mark, then each byte as UART (start 0, 8 data bits LSB first, stop 1), then a mark tail.
 * Continuous phase, raised-cosine fade in/out.
 */
export function fskModulate(bytes: Uint8Array, sampleRate: number, amplitude = 0.8): Float32Array {
  const lead = Math.round((sampleRate * FSK.leadInMs) / 1000);
  const dataLen = Math.round((bytes.length * BITS_PER_BYTE * sampleRate) / FSK.baud);
  const tail = Math.round((sampleRate * FSK.tailMs) / 1000);
  const total = lead + dataLen + tail;
  const out = new Float32Array(total);
  const dMark = (TWO_PI * FSK.mark) / sampleRate;
  const dSpace = (TWO_PI * FSK.space) / sampleRate;
  let phase = 0;
  for (let n = 0; n < total; n++) {
    let mark = true;
    const d = n - lead;
    if (d >= 0 && d < dataLen) {
      const bit = Math.floor((d * FSK.baud) / sampleRate);
      const k = bit % BITS_PER_BYTE;
      if (k === 0) mark = false;
      else if (k <= 8) mark = ((bytes[(bit / BITS_PER_BYTE) | 0] >> (k - 1)) & 1) === 1;
    }
    out[n] = amplitude * Math.sin(phase);
    phase += mark ? dMark : dSpace;
    if (phase >= TWO_PI) phase -= TWO_PI;
  }
  const fade = Math.min(Math.round((sampleRate * FADE_MS) / 1000), total >> 1);
  for (let i = 0; i < fade; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
    out[i] *= g;
    out[total - 1 - i] *= g;
  }
  return out;
}

// ---- receiver ----

const HOPS_PER_BIT = 8;
const RING = 32; // hop history: 4 bits (power of two)
/** Carrier gate: (m + s)^2 / (2 * band-passed mean square). ~1.4 for a clean signal, ~0.1-0.3 for noise. */
const CARRIER_PURITY = 0.6;
/** Below this band-passed mean square (~ -100 dBFS) the input is treated as silence. */
const SILENCE_MS = 1e-10;
/** Abort a frame when no start bit arrives within this many byte-times. */
const ABORT_BYTES = 3;
/** Hunting: a start edge is when (m - s) falls below this fraction of the preceding mark level. */
const TRIGGER = 0.5;
/** Fraction of each measured bit-boundary timing error that is corrected. */
const PLL_GAIN = 0.4;
/** EMA weight for the tracked mark/space levels. */
const LEVEL_ALPHA = 0.2;

const HUNT = 0;
const BITS = 1;

/**
 * Streaming FSK demodulator. Push mic samples in chunks of any size; decoded bytes are fed to a
 * PacketParser whose events are forwarded (plus `onAbort`).
 *
 * Tone detector: each tone is mixed to DC by a complex oscillator and summed per hop (1/8 bit);
 * the last 8 hop sums give a one-bit sliding DFT (same output as a sliding Goertzel) every hop.
 * Over a one-bit window the two tones are orthogonal. The decision variable is A = m - s
 * (mark minus space magnitude), sliced at the midpoint of the tracked mark and space levels, so
 * speaker/mic tilt and steady room reverb do not bias it.
 *
 * Timing: idle -> a start edge is found when A falls to half the preceding mark level (gated on
 * a clean carrier), then refined at the start-bit centre once the space level is known; the start
 * bit must be space at its centre (glitch rejection). Bits are sampled at their centres. Every
 * bit transition is timed (A crossing the slicer level) and nudges the bit clock, which absorbs
 * clock drift and reverb jitter. Bytes are sent back to back, so after a stop bit the next start
 * bit is expected on the same grid; if it is not there the receiver goes back to edge hunting.
 */
export class FskReceiver {
  private readonly hop: number;
  private readonly win: number;
  private readonly spb: number;
  private readonly norm: number;
  private readonly dMark: number;
  private readonly dSpace: number;
  private readonly rMr: number;
  private readonly rMi: number;
  private readonly rSr: number;
  private readonly rSi: number;
  // band-pass (RBJ, 0 dB peak, Q 1) used only for the carrier gate's energy reference
  private readonly b0: number;
  private readonly a1: number;
  private readonly a2: number;
  private readonly parser: PacketParser;
  private delivered = false;

  // per-sample state
  private z1 = 0;
  private z2 = 0;
  private fill = 0;
  private phMark = 0;
  private phSpace = 0;
  private cMr = 1;
  private cMi = 0;
  private cSr = 1;
  private cSi = 0;
  private aMr = 0;
  private aMi = 0;
  private aSr = 0;
  private aSi = 0;
  private aE = 0;

  // per-hop sums of the last HOPS_PER_BIT hops
  private readonly bMr = new Float64Array(HOPS_PER_BIT);
  private readonly bMi = new Float64Array(HOPS_PER_BIT);
  private readonly bSr = new Float64Array(HOPS_PER_BIT);
  private readonly bSi = new Float64Array(HOPS_PER_BIT);
  private readonly bE = new Float64Array(HOPS_PER_BIT);

  // hop history: mark/space magnitudes (~ tone amplitudes) and carrier flag
  private h = -1; // index of the last completed hop
  private readonly hm = new Float64Array(RING);
  private readonly hs = new Float64Array(RING);
  private readonly hc = new Uint8Array(RING);

  // UART state
  private state = HUNT;
  private huntFrom = 0;
  private edge = 0; // start edge of the current byte (absolute sample time)
  private k = 0; // next bit to decide: 0 start, 1..8 data, 9 stop
  private nextT = 0; // centre of bit k
  private refined = false;
  private grid = false; // this byte's edge was predicted from the previous byte
  private byte = 0;
  private prevBit = 1;
  private lm = 0; // tracked A level of a mark bit
  private ls = 0; // tracked A level of a space bit
  private lastByteEnd = 0;
  private bytes = 0;

  constructor(
    sampleRate: number,
    private readonly events: FskEvents,
  ) {
    this.spb = sampleRate / FSK.baud;
    this.hop = Math.max(1, Math.round(this.spb / HOPS_PER_BIT));
    this.win = this.hop * HOPS_PER_BIT;
    this.norm = 2 / this.win;
    this.dMark = (TWO_PI * FSK.mark) / sampleRate;
    this.dSpace = (TWO_PI * FSK.space) / sampleRate;
    this.rMr = Math.cos(this.dMark);
    this.rMi = -Math.sin(this.dMark);
    this.rSr = Math.cos(this.dSpace);
    this.rSi = -Math.sin(this.dSpace);
    const w0 = (TWO_PI * Math.sqrt(FSK.mark * FSK.space)) / sampleRate;
    const alpha = Math.sin(w0) / 2;
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.a1 = (-2 * Math.cos(w0)) / a0;
    this.a2 = (1 - alpha) / a0;
    this.parser = new PacketParser({
      onFrameStart: () => this.events.onFrameStart?.(),
      onHeader: (hd) => this.events.onHeader?.(hd),
      onTextChunk: (t) => this.events.onTextChunk?.(t),
      onPacket: (p, ok) => {
        this.delivered = true;
        this.events.onPacket?.(p, ok);
      },
    });
  }

  /** Inside a packet frame (magic seen, packet not yet complete). */
  get busy(): boolean {
    return this.parser.inFrame;
  }

  /** Bytes decoded since construction/reset (diagnostics). */
  get bytesDecoded(): number {
    return this.bytes;
  }

  reset(): void {
    this.parser.reset();
    this.z1 = this.z2 = 0;
    this.fill = 0;
    this.phMark = this.phSpace = 0;
    this.cMr = this.cSr = 1;
    this.cMi = this.cSi = 0;
    this.aMr = this.aMi = this.aSr = this.aSi = this.aE = 0;
    this.h = -1;
    this.hm.fill(0);
    this.hs.fill(0);
    this.hc.fill(0);
    this.state = HUNT;
    this.huntFrom = 0;
    this.lastByteEnd = 0;
    this.bytes = 0;
  }

  push(samples: Float32Array): void {
    const { b0, a1, a2, rMr, rMi, rSr, rSi, hop } = this;
    let { z1, z2, fill, cMr, cMi, cSr, cSi, aMr, aMi, aSr, aSi, aE } = this;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const y = b0 * x + z1;
      z1 = z2 - a1 * y;
      z2 = -b0 * x - a2 * y;
      aE += y * y;
      aMr += x * cMr;
      aMi += x * cMi;
      aSr += x * cSr;
      aSi += x * cSi;
      let t = cMr * rMr - cMi * rMi;
      cMi = cMr * rMi + cMi * rMr;
      cMr = t;
      t = cSr * rSr - cSi * rSi;
      cSi = cSr * rSi + cSi * rSr;
      cSr = t;
      if (++fill === hop) {
        fill = 0;
        const k = (this.h + 1) % HOPS_PER_BIT;
        this.bMr[k] = aMr;
        this.bMi[k] = aMi;
        this.bSr[k] = aSr;
        this.bSi[k] = aSi;
        this.bE[k] = aE;
        aMr = aMi = aSr = aSi = aE = 0;
        // Re-derive the oscillators from exact phase so rounding never accumulates.
        this.phMark = (this.phMark + this.dMark * hop) % TWO_PI;
        this.phSpace = (this.phSpace + this.dSpace * hop) % TWO_PI;
        cMr = Math.cos(this.phMark);
        cMi = -Math.sin(this.phMark);
        cSr = Math.cos(this.phSpace);
        cSi = -Math.sin(this.phSpace);
        if (Math.abs(z1) < 1e-30) z1 = 0; // no denormals in long silence
        if (Math.abs(z2) < 1e-30) z2 = 0;
        this.endHop();
      }
    }
    this.z1 = z1;
    this.z2 = z2;
    this.fill = fill;
    this.cMr = cMr;
    this.cMi = cMi;
    this.cSr = cSr;
    this.cSi = cSi;
    this.aMr = aMr;
    this.aMi = aMi;
    this.aSr = aSr;
    this.aSi = aSi;
    this.aE = aE;
  }

  /** Centre (absolute sample time) of the one-bit window that ends with hop `i`. */
  private centre(i: number): number {
    return (i + 1) * this.hop - this.win / 2;
  }

  /** Fractional hop index whose window is centred at time `t`. */
  private hopAt(t: number): number {
    return (t + this.win / 2) / this.hop - 1;
  }

  /** Decision variable of hop `i`: mark minus space magnitude. */
  private A(i: number): number {
    const r = i & (RING - 1);
    return this.hm[r] - this.hs[r];
  }

  /** A interpolated at time t (clamped to the hop history). */
  private aAt(t: number, h: number): number {
    const x = this.hopAt(t);
    const i0 = Math.min(Math.max(Math.floor(x), h - RING + 1), h - 1);
    const f = Math.min(Math.max(x - i0, 0), 1);
    const a0 = this.A(i0);
    return a0 + f * (this.A(i0 + 1) - a0);
  }

  private carrierAt(t: number, h: number): boolean {
    const i = Math.min(Math.max(Math.round(this.hopAt(t)), h - RING + 1), h);
    return this.hc[i & (RING - 1)] === 1;
  }

  /** Time where A crosses `thr` in the given direction nearest to `t` (within half a bit), or NaN. */
  private crossing(t: number, thr: number, falling: boolean, h: number): number {
    const half = 0.5 * this.spb;
    const i0 = Math.max(Math.floor(this.hopAt(t - half)), h - RING + 1);
    const i1 = Math.min(Math.ceil(this.hopAt(t + half)), h);
    let best = NaN;
    let bestD = half;
    for (let i = i0; i < i1; i++) {
      const a0 = this.A(i);
      const a1 = this.A(i + 1);
      if (falling ? a0 >= thr && a1 < thr : a0 <= thr && a1 > thr) {
        const c = this.centre(i) + (this.hop * (a0 - thr)) / (a0 - a1);
        const d = Math.abs(c - t);
        if (d <= bestD) {
          best = c;
          bestD = d;
        }
      }
    }
    return best;
  }

  private endHop(): void {
    const h = ++this.h;
    const r = h & (RING - 1);
    if (h < HOPS_PER_BIT - 1) {
      this.hm[r] = this.hs[r] = this.hc[r] = 0;
      return;
    }
    let mr = 0;
    let mi = 0;
    let sr = 0;
    let si = 0;
    let e = 0;
    for (let k = 0; k < HOPS_PER_BIT; k++) {
      mr += this.bMr[k];
      mi += this.bMi[k];
      sr += this.bSr[k];
      si += this.bSi[k];
      e += this.bE[k];
    }
    const m = this.norm * Math.sqrt(mr * mr + mi * mi);
    const s = this.norm * Math.sqrt(sr * sr + si * si);
    const ms = e / this.win;
    this.hm[r] = m;
    this.hs[r] = s;
    this.hc[r] = ms > SILENCE_MS && (m + s) * (m + s) > 2 * CARRIER_PURITY * ms ? 1 : 0;
    if (h < 2 * HOPS_PER_BIT) return; // need a bit of history
    const tc = this.centre(h);
    if (this.state === HUNT) this.hunt(h, tc);
    for (let guard = 0; this.state === BITS && tc >= this.nextT && guard < 4; guard++) this.decide(h, tc);
  }

  private hunt(h: number, tc: number): void {
    const inFrame = this.parser.inFrame;
    if (inFrame && tc > this.lastByteEnd + ABORT_BYTES * BITS_PER_BYTE * this.spb) {
      this.parser.reset();
      this.events.onAbort?.();
      return;
    }
    if (tc <= this.huntFrom) return;
    const a0 = this.A(h - 1);
    const a1 = this.A(h);
    if (!(a1 < a0)) return;
    // Preceding mark level: peak of A over the last bit (the stop bit or idle mark).
    let ref = -Infinity;
    let b = 0;
    for (let j = 2; j <= HOPS_PER_BIT + 1; j++) {
      const v = this.A(h - j);
      if (v > ref) {
        ref = v;
        b = (h - j) & (RING - 1);
      }
    }
    if (!(this.hm[b] > 2 * this.hs[b])) return; // must follow a clean mark
    if (!inFrame && !(this.hc[b] && this.hc[h & (RING - 1)])) return;
    const thr = TRIGGER * ref;
    if (!(a0 >= thr && a1 < thr)) return;
    this.beginByte(this.centre(h - 1) + (this.hop * (a0 - thr)) / (a0 - a1), false);
    this.lm = ref;
  }

  private beginByte(edge: number, grid: boolean): void {
    this.state = BITS;
    this.edge = edge;
    this.grid = grid;
    this.refined = false;
    this.k = 0;
    this.byte = 0;
    this.prevBit = 1;
    this.nextT = edge + 0.5 * this.spb;
  }

  private toHunt(tc: number): void {
    this.state = HUNT;
    this.huntFrom = tc;
  }

  private decide(h: number, tc: number): void {
    const spb = this.spb;
    const k = this.k;
    if (k === 0 && !this.refined) {
      // Refine the start edge: where A crosses the slicer level between mark and space levels.
      this.refined = true;
      if (!this.grid) {
        // First byte after idle: take the space level from what the start bit has shown so far.
        let mn = Infinity;
        for (let i = Math.max(Math.ceil(this.hopAt(this.edge)), h - RING + 1); i <= h; i++) mn = Math.min(mn, this.A(i));
        this.ls = mn;
      }
      const c = this.crossing(this.edge, 0.5 * (this.lm + this.ls), true, h);
      if (!Number.isNaN(c)) {
        this.edge += (this.grid ? PLL_GAIN : 1) * (c - this.edge);
        this.nextT = this.edge + 0.5 * spb;
        if (this.nextT > tc) return; // wait for the refined start-bit centre
      }
    }
    const a = this.aAt(this.nextT, h);
    const thr = 0.5 * (this.lm + this.ls);
    if (k === 0) {
      // The start bit must be clearly space at its centre: rejects glitches, false edges, noise.
      if (!(a < thr && a < 0.5 * this.lm && this.carrierAt(this.nextT, h))) {
        this.toHunt(tc);
        return;
      }
      this.ls = this.grid ? this.ls + LEVEL_ALPHA * (a - this.ls) : a;
      this.prevBit = 0;
      this.k = 1;
      this.nextT = this.edge + 1.5 * spb;
      return;
    }
    const bit = a > thr ? 1 : 0;
    if (bit !== this.prevBit) {
      const boundary = this.edge + k * spb;
      const c = this.crossing(boundary, thr, bit === 0, h);
      if (!Number.isNaN(c)) this.edge += PLL_GAIN * (c - boundary);
    }
    if (bit) this.lm += LEVEL_ALPHA * (a - this.lm);
    else this.ls += LEVEL_ALPHA * (a - this.ls);
    this.prevBit = bit;
    if (k <= 8) {
      this.byte |= bit << (k - 1);
      this.k = k + 1;
      this.nextT = this.edge + (k + 1.5) * spb;
      return;
    }
    // Stop bit. Outside a frame a framing error means a false start; inside one keep the byte
    // (the CRC decides). Bytes are sent back to back, so expect the next start bit on this grid.
    const inFrame = this.parser.inFrame;
    const keep = inFrame || (bit === 1 && this.carrierAt(this.nextT, h));
    const value = this.byte;
    this.lastByteEnd = this.edge + BITS_PER_BYTE * spb;
    if (keep) this.beginByte(this.lastByteEnd, true);
    else this.toHunt(tc);
    if (keep) this.deliver(value);
  }

  private deliver(b: number): void {
    this.bytes++;
    const was = this.parser.inFrame;
    this.delivered = false;
    this.parser.pushByte(b);
    // The parser dropped the frame (bad length/header) without producing a packet.
    if (was && !this.parser.inFrame && !this.delivered) this.events.onAbort?.();
  }
}

