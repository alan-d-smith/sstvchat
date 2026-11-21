// Offline decoder for radio recordings (e.g. "Record 10 s" in Radio details, or make-wav.mjs):
// runs a WAV through the app's own FskReceiver and Robot36Receiver and prints every event with
// its time in the file.
//
//   node scripts/decode-wav.ts <file.wav> [--self bob] [--levels] [--no-scan] [--channel 0]
//
//   --self      say what a device claimed as this username would do with each packet
//   --levels    print RMS / 1200 Hz / 2200 Hz / noise floor every 100 ms (spot AGC or noise
//               suppression eating the tones: a steady tone that fades within ~0.5 s)
//   --no-scan   skip the independent SSTV scan (VIS search over the whole file)
// Snap images are written next to the WAV as <file>.snapN.bmp (portrait, as shown in the app).
import { readFileSync, writeFileSync } from 'node:fs';
import { runnerImport } from 'vite';

type AnyRecord = Record<string, any>;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const self = opt('self');
const channel = Number(opt('channel') ?? 0);
const levels = flag('levels');
const scan = !flag('no-scan');
const file = args[0];
if (!file) {
  console.error('usage: node scripts/decode-wav.ts <file.wav> [--self name] [--levels] [--no-scan] [--channel n]');
  process.exit(2);
}

const load = async (id: string): Promise<AnyRecord> => (await runnerImport(id, { configFile: false, logLevel: 'silent' })).module as AnyRecord;
const { FskReceiver } = await load('./src/audio/fsk.ts');
const { Robot36Receiver } = await load('./src/audio/robot36.ts');
const { measure } = await load('./src/audio/diagnostics.ts');
const { VIS_TIMEOUT_MS } = await load('./src/audio/audioTransport.ts');

/* ---------------------------------------------------------------- WAV */

function readWav(path: string): { x: Float32Array; rate: number; info: string } {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  for (let o = 12; o + 8 <= b.length; ) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    const body = b.subarray(o + 8, Math.min(b.length, o + 8 + size));
    if (id === 'fmt ') {
      let format = body.readUInt16LE(0);
      if (format === 0xfffe && body.length >= 26) format = body.readUInt16LE(24); // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    } else if (id === 'data') {
      data = body;
    }
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');
  const { format, channels, rate, bits } = fmt;
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const ch = Math.min(channel, channels - 1);
  const x = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const o = (i * channels + ch) * bytes;
    if (format === 3 && bits === 32) x[i] = data.readFloatLE(o);
    else if (format === 1 && bits === 16) x[i] = data.readInt16LE(o) / 32768;
    else if (format === 1 && bits === 24) x[i] = data.readIntLE(o, 3) / 8388608;
    else if (format === 1 && bits === 32) x[i] = data.readInt32LE(o) / 2147483648;
    else if (format === 1 && bits === 8) x[i] = (data[o] - 128) / 128;
    else throw new Error(`unsupported WAV format ${format} / ${bits} bit`);
  }
  return { x, rate, info: `${rate} Hz, ${bits}-bit ${format === 3 ? 'float' : 'PCM'}, ${channels} ch (using ch ${ch}), ${(frames / rate).toFixed(2)} s` };
}

/** Portrait 240×320 BMP from landscape Robot36 rows (landscape row i = portrait column i). */
function writeBmp(path: string, rows: Map<number, Uint8ClampedArray>) {
  const W = 240;
  const H = 320;
  const stride = W * 3;
  const out = Buffer.alloc(54 + stride * H);
  out.write('BM', 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(W, 18);
  out.writeInt32LE(H, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(stride * H, 34);
  for (let py = 0; py < H; py++) {
    const line = 54 + (H - 1 - py) * stride; // bottom-up
    for (let px = 0; px < W; px++) {
      const row = rows.get(px);
      const s = (H - 1 - py) * 4; // landscape x = 319 - py
      out[line + px * 3] = row ? row[s + 2] : 0;
      out[line + px * 3 + 1] = row ? row[s + 1] : 0;
      out[line + px * 3 + 2] = row ? row[s] : 0;
    }
  }
  writeFileSync(path, out);
}

/* ---------------------------------------------------------------- decode */

const { x, rate, info } = readWav(file);
console.log(`${file}: ${info}`);
const CHUNK = 256;
let pos = 0; // samples pushed so far
const t = () => `${(pos / rate).toFixed(3).padStart(8)} s`;
const say = (what: string, ...rest: unknown[]) => console.log(t(), what, ...rest);

const verdict = (h: AnyRecord) => {
  if (!self) return '';
  if (h.from === self) return '→ ignored: own packet';
  if (!h.to.includes(self)) return `→ ignored: not addressed to ${self}`;
  return '→ accepted';
};

const counts = { bytesBefore: 0, frames: 0, headers: 0, crcOk: 0, crcFail: 0, aborts: 0, snaps: 0 };
let mode: 'fsk' | 'sstv' = 'fsk';
let sstvNext: AnyRecord | null = null;
let sstv: AnyRecord | null = null;
let snapN = 0;

const fsk = new FskReceiver(rate, {
  onFrameStart: () => {
    counts.frames++;
    say('FSK frame start (magic)');
  },
  onHeader: (h: AnyRecord) => {
    counts.headers++;
    say(`FSK header  ${h.kind} ${h.from}${h.fromName ? ` (${h.fromName})` : ''} → [${h.to.join(',')}] chat=${h.chatId || '-'} mode=${h.mode || '-'} id=${h.id || '-'}`, verdict(h));
  },
  onTextChunk: () => {},
  onPacket: (p: AnyRecord, ok: boolean) => {
    counts[ok ? 'crcOk' : 'crcFail']++;
    say(`FSK packet  CRC ${ok ? 'ok' : 'FAIL'}  ${p.kind} ${p.from} → [${p.to.join(',')}] id=${p.id || '-'}${p.kind === 'text' ? `  text=${JSON.stringify(p.text)}` : ''}`, verdict(p));
    if (ok && p.kind === 'snap' && (!self || verdict(p) === '→ accepted')) {
      counts.snaps++;
      sstvNext = p;
    }
  },
  onAbort: () => {
    counts.aborts++;
    say('FSK abort (frame lost before CRC)');
  },
});

function startSstv(p: AnyRecord) {
  const n = ++snapN;
  const rows = new Map<number, Uint8ClampedArray>();
  let last = -1;
  const end = (why: string) => {
    say(`SSTV #${n} ${why}  (${rows.size} rows)`);
    if (rows.size) {
      const out = `${file}.snap${n}.bmp`;
      writeBmp(out, rows);
      say(`SSTV #${n} image → ${out}`);
    }
    mode = 'fsk';
    sstv = null;
    counts.bytesBefore += fsk.bytesDecoded;
    fsk.reset();
  };
  sstv = new Robot36Receiver(rate, {
    onStart: () => say(`SSTV #${n} VIS found (code ${sstv?.visCode}) from ${p.from}`),
    onRow: (i: number, row: Uint8ClampedArray) => rows.set(i, row),
    onProgress: (q: number) => {
      const step = Math.floor(q * 10);
      if (step !== last) {
        last = step;
        if (step > 0 && step < 10) say(`SSTV #${n} ${step * 10}%`);
      }
    },
    onDone: () => end('done'),
    onTimeout: () => end(`no VIS within ${VIS_TIMEOUT_MS / 1000} s (timeout)`),
  }, { visTimeoutMs: VIS_TIMEOUT_MS });
  mode = 'sstv';
  say(`SSTV #${n} waiting for VIS (as the app does after a snap header)`);
}

// Independent VIS scan over the whole file, whatever the FSK side heard.
let scanRx: AnyRecord | null = null;
let scans = 0;
const newScan = () => {
  const k = ++scans;
  let rowsSeen = 0;
  scanRx = new Robot36Receiver(rate, {
    onStart: () => say(`[scan] SSTV VIS found (code ${scanRx?.visCode})`),
    onRow: () => rowsSeen++,
    onDone: () => {
      say(`[scan] SSTV image complete (${rowsSeen} rows)`);
      newScan();
    },
  }, { visTimeoutMs: 1e12 });
  return k;
};
if (scan) newScan();

let nextLevel = 0;
for (pos = 0; pos < x.length; ) {
  const chunk = x.subarray(pos, Math.min(x.length, pos + CHUNK));
  if (levels && pos >= nextLevel) {
    const w = x.subarray(pos, Math.min(x.length, pos + Math.round(rate * 0.1)));
    const m = measure(w, rate);
    const f = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-inf').padStart(6);
    say(`level  rms ${f(m.rmsDb)}  1200Hz ${f(m.markDb)}  2200Hz ${f(m.spaceDb)}  floor ${f(m.floorDb)}  dBFS`);
    nextLevel += Math.round(rate * 0.1);
  }
  if (mode === 'sstv' && sstv) sstv.push(chunk);
  else fsk.push(chunk);
  scanRx?.push(chunk);
  pos += chunk.length;
  if (sstvNext && mode === 'fsk') {
    const p = sstvNext;
    sstvNext = null;
    startSstv(p);
  }
}
if (mode === 'sstv') say('SSTV still receiving at end of file');
console.log(
  `\nsummary: bytes ${counts.bytesBefore + fsk.bytesDecoded} · frames ${counts.frames} · headers ${counts.headers} · CRC ok ${counts.crcOk} · CRC fail ${counts.crcFail} · aborts ${counts.aborts} · snap headers ${counts.snaps}`,
);
