// Radio diagnostics: receiver counters and a decision log (kept by the audio transport), an input
// meter with the power at the two FSK tones, and raw-mic recording to a 16-bit WAV. Read-only:
// nothing here changes what the radio does.

import { FSK } from './fsk';
import type { AudioEngine } from './engine';

export interface RadioStats {
  /** Bytes out of the FSK UART (any byte, framed or not). */
  bytes: number;
  /** Packet magic seen. */
  frames: number;
  headers: number;
  crcOk: number;
  crcFail: number;
  /** Frames dropped before their CRC (lost carrier, bad length/header). */
  aborts: number;
  sstvStarted: number;
  sstvDone: number;
  /** Snap headers whose SSTV image never started (no VIS). */
  visTimeouts: number;
  /** Stretches of clear two-tone audio in which no frame was found (see createToneWatch). */
  undecodedTones: number;
}

export interface RadioLogEntry {
  /** Date.now() */
  at: number;
  kind: string;
  from: string;
  to: string[];
  id: string;
  /** accepted / ignored: … / CRC fail / aborted / SSTV … */
  decision: string;
}

export interface RadioDiag {
  stats(): RadioStats;
  /** Newest last; at most LOG_SIZE entries. */
  log(): RadioLogEntry[];
  count(k: keyof RadioStats, n?: number): void;
  add(e: Omit<RadioLogEntry, 'at'>): void;
  /** An SSTV image is being received (the FSK receiver is not listening meanwhile). */
  receivingImage(): boolean;
}

export const LOG_SIZE = 10;

/** Counters and the decision log (bumped by the transport and the tone watch). */
export function createRadioDiag(opts: { receivingImage?: () => boolean } = {}): RadioDiag {
  const s: RadioStats = { bytes: 0, frames: 0, headers: 0, crcOk: 0, crcFail: 0, aborts: 0, sstvStarted: 0, sstvDone: 0, visTimeouts: 0, undecodedTones: 0 };
  const entries: RadioLogEntry[] = [];
  return {
    stats: () => ({ ...s }),
    receivingImage: () => opts.receivingImage?.() ?? false,
    log: () => [...entries],
    count(k, n = 1) {
      s[k] += n;
    },
    add(e) {
      entries.push({ at: Date.now(), ...e });
      if (entries.length > LOG_SIZE) entries.shift();
    },
  };
}

/* ---------------------------------------------------------------- input meter */

let hann = new Float32Array(0);
function hannOf(n: number): Float32Array {
  if (hann.length !== n) hann = Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  return hann;
}

/** Tone amplitude in a Hann-windowed block, as a sine amplitude (1 = full scale). */
function toneAmplitude(x: Float32Array, rate: number, freq: number): number {
  const n = x.length;
  const w = (2 * Math.PI * freq) / rate;
  const c = 2 * Math.cos(w);
  const win = hannOf(n);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = x[i] * win[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const re = s1 - s2 * Math.cos(w);
  const im = s2 * Math.sin(w);
  return (4 * Math.sqrt(re * re + im * im)) / n; // Hann: coherent gain 0.5
}

export const dbfs = (amplitude: number) => (amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity);

/** Bins away from both FSK tones, averaged for the noise floor. */
export const FLOOR_HZ = [800, 1700, 2700];

export interface InputLevels {
  rmsDb: number;
  peakDb: number;
  markDb: number;
  spaceDb: number;
  floorDb: number;
  /** Mic chunks / seconds of audio delivered since the meter started. */
  chunks: number;
  seconds: number;
  sampleRate: number;
}

/** Levels of a block of samples (dBFS; tones as sine amplitude). */
export function measure(x: Float32Array, rate: number): Omit<InputLevels, 'chunks' | 'seconds' | 'sampleRate'> {
  let e = 0;
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    e += x[i] * x[i];
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
  }
  const floor = FLOOR_HZ.reduce((sum, f) => sum + toneAmplitude(x, rate, f) ** 2, 0) / FLOOR_HZ.length;
  return {
    rmsDb: dbfs(Math.sqrt(e / Math.max(1, x.length))),
    peakDb: dbfs(peak),
    markDb: dbfs(toneAmplitude(x, rate, FSK.mark)),
    spaceDb: dbfs(toneAmplitude(x, rate, FSK.space)),
    floorDb: dbfs(Math.sqrt(floor)),
  };
}

const WINDOW_S = 0.2;

/**
 * Listens to the same mic chunks the receiver gets (engine.onSamples): live levels over the last
 * 0.2 s, and recordings of the raw samples.
 */
export function createInputMeter(engine: AudioEngine) {
  let ring = new Float32Array(0);
  let pos = 0;
  let chunks = 0;
  let samples = 0;
  let rate = 0;
  let recording: { parts: Float32Array[]; n: number; want: number; done(x: Float32Array): void } | null = null;

  const finishRecording = () => {
    const r = recording;
    if (!r) return;
    recording = null;
    const out = new Float32Array(Math.min(r.n, r.want));
    let o = 0;
    for (const p of r.parts) {
      const take = Math.min(p.length, out.length - o);
      out.set(p.subarray(0, take), o);
      o += take;
    }
    r.done(out);
  };

  const off = engine.onSamples((chunk) => {
    const sr = engine.sampleRate;
    if (sr !== rate) {
      rate = sr;
      ring = new Float32Array(Math.round(WINDOW_S * sr));
      pos = 0;
    }
    chunks++;
    samples += chunk.length;
    for (let i = 0; i < chunk.length; i++) {
      ring[pos] = chunk[i];
      pos = pos + 1 === ring.length ? 0 : pos + 1;
    }
    if (recording) {
      recording.parts.push(chunk.slice());
      recording.n += chunk.length;
      if (recording.n >= recording.want) finishRecording();
    }
  });

  return {
    levels(): InputLevels {
      const ordered = new Float32Array(ring.length);
      ordered.set(ring.subarray(pos));
      ordered.set(ring.subarray(0, pos), ring.length - pos);
      const m = rate ? measure(ordered, rate) : { rmsDb: -Infinity, peakDb: -Infinity, markDb: -Infinity, spaceDb: -Infinity, floorDb: -Infinity };
      return { ...m, chunks, seconds: rate ? samples / rate : 0, sampleRate: rate };
    },
    /** Records the next `ms` of raw mic samples (ends early, with what it has, if the mic stalls). */
    record(ms: number): Promise<{ samples: Float32Array; sampleRate: number }> {
      return new Promise((resolve) => {
        const sr = engine.sampleRate;
        const guard = setTimeout(finishRecording, ms + 3000);
        recording = {
          parts: [],
          n: 0,
          want: Math.round((ms * sr) / 1000),
          done: (x) => {
            clearTimeout(guard);
            resolve({ samples: x, sampleRate: sr });
          },
        };
      });
    },
    recordedSoFar: () => (recording && rate ? recording.n / rate : 0),
    dispose() {
      off();
      finishRecording();
    },
  };
}

/** 16-bit PCM mono WAV. */
export function encodeWav16(x: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + x.length * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i);
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + x.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) {
    const s = Math.max(-1, Math.min(1, x[i]));
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return out;
}

/* ---------------------------------------------------------------- undecoded-tone watch */

/** Clear two-tone audio for this long with no frame found → the hint. */
export const HINT_TONE_S = 1.5;
/** A tone stretch ends after this much non-tone audio. */
const STRETCH_GAP_S = 0.5;
/** "Clear" tones: the stronger FSK tone this far above the noise-floor bins… */
const TONE_OVER_FLOOR_DB = 15;
/** …not just room noise… */
const MIN_TONE_DB = -70;
/** …and the two tones carrying a good share of all the energy (SSTV, speech, music do not). */
const MIN_PURITY = 0.2;
/** FSK alternates: each tone must lead in at least this share of a stretch's tone chunks (a bright
 * SSTV image sits on ~2200 Hz alone; a steady test tone is one tone). */
const MIN_EACH_TONE = 0.15;

const power = (db: number) => (Number.isFinite(db) ? 10 ** (db / 10) : 0);

/** Which FSK tone a mic chunk clearly carries ('mark' / 'space'), or null if it is not FSK-like. */
export function fskTone(chunk: Float32Array, rate: number): 'mark' | 'space' | null {
  const m = measure(chunk, rate);
  const tone = Math.max(m.markDb, m.spaceDb);
  const purity = (power(m.markDb) + power(m.spaceDb)) / (2 * Math.max(power(m.rmsDb), 1e-20));
  if (!(tone > MIN_TONE_DB && tone - m.floorDb >= TONE_OVER_FLOOR_DB && purity >= MIN_PURITY)) return null;
  return m.markDb >= m.spaceDb ? 'mark' : 'space';
}

/**
 * Watches the mic for FSK-like tones the receiver cannot frame (e.g. OS "audio enhancements" /
 * noise suppression mangling the tones): calls `onUndecoded` once per stretch of clear two-tone
 * audio that lasts HINT_TONE_S without a new frame in `receiver`. Stands down while an SSTV
 * image is being received (no FSK is decoded then). Subscribe it after the transport so each
 * chunk is decoded before it is judged.
 */
export function createToneWatch(
  engine: AudioEngine,
  receiver: Pick<RadioDiag, 'stats' | 'receivingImage'>,
  onUndecoded: () => void,
): () => void {
  const framesSeen = () => receiver.stats().frames;
  let inStretch = false;
  let tone = 0;
  let marks = 0;
  let spaces = 0;
  let quiet = 0;
  let framesAtStart = 0;
  let fired = false;
  return engine.onSamples((chunk) => {
    if (receiver.receivingImage()) {
      inStretch = false;
      return;
    }
    const rate = engine.sampleRate;
    const dur = chunk.length / rate;
    const which = fskTone(chunk, rate);
    if (which) {
      if (!inStretch) {
        inStretch = true;
        tone = marks = spaces = 0;
        fired = false;
        framesAtStart = framesSeen();
      }
      tone += dur;
      if (which === 'mark') marks++;
      else spaces++;
      quiet = 0;
      const bothTones = Math.min(marks, spaces) >= MIN_EACH_TONE * (marks + spaces);
      if (!fired && tone >= HINT_TONE_S && bothTones && framesSeen() === framesAtStart) {
        fired = true;
        onUndecoded();
      }
    } else if (inStretch) {
      quiet += dur;
      if (quiet >= STRETCH_GAP_S) inStretch = false;
    }
  });
}
