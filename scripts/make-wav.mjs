// Writes test recordings of what the app transmits, using the real modems and transport:
//   text.wav  alice → bob two-tone text packet
//   snap.wav  alice → bob snap: FSK header (from/to) + 300 ms + Robot36 of a test image
//   both.wav  the text, then the snap
// Each has 1 s of quiet room noise before and 2 s after. 48 kHz, 16-bit mono PCM.
// Use one as a fake microphone:
//   chrome --use-fake-ui-for-media-stream --use-fake-device-for-media-stream \
//          --use-file-for-fake-audio-capture=both.wav
//
// Usage: node scripts/make-wav.mjs [outDir] [--from alice] [--to bob] [--text "…"]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runnerImport } from 'vite';

const RATE = 48000;
const LEVEL = 0.5; // on top of the modulators' own level (FSK 0.95, Robot36 0.8)
const NOISE = 0.003;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const from = opt('from', 'alice');
const to = opt('to', 'bob');
const text = opt('text', `hello ${to}, this came over the air 📻`);
const outDir = resolve(args[0] ?? join(tmpdir(), 'sstvchat-wav'));

// The modems use ImageData; Node has none.
globalThis.ImageData ??= class ImageData {
  constructor(a, b, c) {
    if (typeof a === 'number') {
      this.width = a;
      this.height = b;
      this.data = new Uint8ClampedArray(a * b * 4);
    } else {
      this.data = a;
      this.width = b;
      this.height = c ?? a.length / 4 / b;
    }
  }
};

const load = async (id) => (await runnerImport(id, { configFile: false, logLevel: 'silent' })).module;
const { createAudioTransport } = await load('./src/audio/audioTransport.ts');
const { createMockTransport } = await load('./src/sim/transport.ts');

/** What the app would play for one send, captured from a recording engine. */
async function transmit(send) {
  let played = null;
  const engine = {
    sampleRate: RATE,
    state: () => 'listening',
    start: async () => {},
    onState: () => () => {},
    onSamples: () => () => {},
    play(samples) {
      played = samples;
      return { done: new Promise(() => {}), stop() {} };
    },
  };
  const t = createAudioTransport({
    engine,
    self: () => ({ id: from, name: from }),
    recipients: () => [to],
    fallback: createMockTransport(),
  });
  send(t);
  if (!played) throw new Error('nothing was transmitted');
  return played;
}

/** Portrait 240×320 test snap: four colour bands, a checkerboard band and a white diagonal. */
function testSnap() {
  const img = new ImageData(240, 320);
  const bands = [[230, 40, 40], [40, 190, 80], [40, 90, 230], [245, 225, 50]];
  for (let y = 0; y < 320; y++) {
    for (let x = 0; x < 240; x++) {
      let c = bands[Math.min(3, Math.floor(y / 64))];
      if (y >= 256) c = ((x >> 4) + (y >> 4)) & 1 ? [255, 255, 255] : [0, 0, 0];
      if (Math.abs(x - (y * 240) / 320) < 3) c = [255, 255, 255];
      img.data.set([c[0], c[1], c[2], 255], (y * 240 + x) * 4);
    }
  }
  return img;
}

let seed = 1;
const noise = () => {
  seed = (seed * 1103515245 + 12345) >>> 0;
  return NOISE * ((seed / 2 ** 32) * 2 - 1);
};
const quiet = (ms) => new Float32Array(Math.round((RATE * ms) / 1000));

function wav(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  let o = 44;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++, o += 2) {
      const v = Math.max(-1, Math.min(1, p[i] * LEVEL + noise()));
      buf.writeInt16LE(Math.round(v * 32767), o);
    }
  }
  return buf;
}

const textAudio = await transmit((t) => t.sendText(to, text));
const snapAudio = await transmit((t) => t.sendSnap([to], testSnap()));

mkdirSync(outDir, { recursive: true });
const files = {
  'text.wav': [quiet(1000), textAudio, quiet(2000)],
  'snap.wav': [quiet(1000), snapAudio, quiet(2000)],
  'both.wav': [quiet(1000), textAudio, quiet(1000), snapAudio, quiet(2000)],
};
for (const [name, parts] of Object.entries(files)) {
  const path = join(outDir, name);
  writeFileSync(path, wav(parts));
  const secs = parts.reduce((s, p) => s + p.length, 0) / RATE;
  console.log(`${path}  ${secs.toFixed(1)} s  (${from} → ${to})`);
}
