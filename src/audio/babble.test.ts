// @vitest-environment node
//
// Loud room with background chatter: an FSK text packet through a small speaker, room echo and
// crowd babble (testChannel.ts) at SNR +10 … −10 dB relative to the FSK at the mic, 48 → 44.1 kHz,
// random mic chunks. Packet success rate per SNR over seeded channels.
//
// By default a few seeds run (a smoke check that also guards the floor). The full sweep prints a
// table:  BABBLE_SEEDS=20 npx vitest run src/audio/babble.test.ts
import { describe, expect, it } from 'vitest';
import { encodePacket, type Packet } from './packet';
import { fskModulate, FskReceiver } from './fsk';
import { resampleLinear } from './dsp';
import { babble, bandLevels, mulberry32, rms, room, speaker } from './testChannel';

const TX = 48000;
const RX = 44100;
const TEXT = 'on my way, see you at the station in ten';
const packet: Packet = { kind: 'text', from: 'alice', fromName: '', to: ['bob'], chatId: 'bob', mode: '', id: 'k3f9', text: TEXT };

const FULL = Number(process.env.BABBLE_SEEDS ?? 0);
const SEEDS = Array.from({ length: FULL || 4 }, (_, i) => i + 1);
const SNRS = FULL ? [10, 8, 6, 4, 2, 0, -2, -4, -6, -8, -10] : [6, 0, -6];

const babbles = new Map<number, Float32Array>();

/** One packet through speaker (profile by seed), room echo, babble at `snrDb`; true if it decodes. */
function delivered(seed: number, snrDb: number): boolean {
  const sig = fskModulate(encodePacket(packet), TX);
  const path = room(speaker(sig, TX, seed % 3), TX, seed + 500, 0.3, 8);
  const lead = Math.round(TX * (0.3 + 0.4 * mulberry32(seed)()));
  const x = new Float32Array(lead + path.length + TX * 0.3);
  for (let i = 0; i < path.length; i++) x[lead + i] = 0.3 * path[i];
  const signal = rms(x, lead, lead + sig.length);
  let b = babbles.get(seed);
  if (!b || b.length < x.length) babbles.set(seed, (b = babble(x.length + TX, TX, seed)));
  const off = Math.floor(mulberry32(seed + 9)() * (b.length - x.length));
  const k = signal / Math.pow(10, snrDb / 20);
  for (let i = 0; i < x.length; i++) x[i] += k * b[off + i];
  const y = resampleLinear(x, TX, RX);
  let ok = false;
  const rx = new FskReceiver(RX, { onPacket: (p, crcOk) => (ok ||= crcOk && p.text === TEXT) });
  const rand = mulberry32(seed + 77);
  for (let i = 0; i < y.length; ) {
    const n = 128 + Math.floor(rand() * 3969);
    rx.push(y.subarray(i, i + n));
    i += n;
  }
  return ok;
}

describe('babble channel', () => {
  it('sounds like speech: long-term spectrum peaks below 1 kHz and falls ~7 dB/octave above', () => {
    const x = babble(TX * 6, TX, 1);
    expect(rms(x)).toBeCloseTo(1, 3);
    const [l500, l1k, l2k, l4k] = bandLevels(x, TX, [500, 1000, 2000, 4000]);
    expect(l500 - l1k).toBeGreaterThan(5);
    expect(l1k - l2k).toBeGreaterThan(4);
    expect(l1k - l4k).toBeGreaterThan(9);
    expect(l1k - l4k).toBeLessThan(20); // not unrealistically dull up top (fricatives, pink floor)
  });

  it('FSK packet success rate vs babble SNR', { timeout: 600_000 }, () => {
    const rate: Record<number, number> = {};
    for (const snr of SNRS) rate[snr] = SEEDS.filter((s) => delivered(s, snr)).length / SEEDS.length;
    if (FULL) {
      console.log(`babble sweep, ${SEEDS.length} seeds\n` + SNRS.map((s) => `${String(s).padStart(4)} dB  ${(100 * rate[s]).toFixed(0).padStart(3)} %`).join('\n'));
    }
    expect(rate[6]).toBeGreaterThanOrEqual(0.75);
  });
});
