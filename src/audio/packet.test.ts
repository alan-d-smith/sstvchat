// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { crc16, encodePacket, MAX_PAYLOAD, PacketParser, type Packet, type PacketHeader } from './packet';

const textPacket: Packet = {
  kind: 'text',
  from: 'alice',
  fromName: 'Alice 🙂',
  to: ['bob', 'carol'],
  chatId: 'chat-alice-bob',
  mode: '',
  text: 'Hello 👋 over the air — ünïcødé 📻!',
};

const snapPacket: Packet = {
  kind: 'snap',
  from: 'bob',
  fromName: 'Bob',
  to: ['alice'],
  chatId: 'chat-alice-bob',
  mode: 'Robot36',
  text: '',
};

type Ev =
  | { t: 'start' }
  | { t: 'header'; h: PacketHeader }
  | { t: 'text'; s: string }
  | { t: 'packet'; p: Packet; ok: boolean };

function collect() {
  const events: Ev[] = [];
  const parser = new PacketParser({
    onFrameStart: () => events.push({ t: 'start' }),
    onHeader: (h) => events.push({ t: 'header', h }),
    onTextChunk: (s) => events.push({ t: 'text', s }),
    onPacket: (p, ok) => events.push({ t: 'packet', p, ok }),
  });
  const feed = (bytes: Iterable<number>) => {
    for (const b of bytes) parser.pushByte(b);
  };
  const packets = () => events.filter((e): e is Extract<Ev, { t: 'packet' }> => e.t === 'packet');
  return { parser, events, feed, packets };
}

describe('crc16', () => {
  it('is CRC-16/CCITT-FALSE', () => {
    expect(crc16(new TextEncoder().encode('123456789'))).toBe(0x29b1);
    expect(crc16(new Uint8Array(0))).toBe(0xffff);
  });
});

describe('encodePacket', () => {
  it('frames magic, big-endian length, payload and CRC', () => {
    const bytes = encodePacket(snapPacket);
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0x53, 0x43, 0x01]);
    const len = (bytes[3] << 8) | bytes[4];
    expect(bytes.length).toBe(len + 7);
    const payload = bytes.subarray(5, 5 + len);
    expect(new TextDecoder().decode(payload)).toBe(['S', 'bob', 'Bob', 'alice', 'chat-alice-bob', 'Robot36', '', ''].join('\x1f'));
    expect((bytes[5 + len] << 8) | bytes[6 + len]).toBe(crc16(payload));
  });

  it('carries an optional message id before the text', () => {
    const { feed, events, packets } = collect();
    feed(encodePacket({ ...textPacket, id: 'k3f9' }));
    expect(events[1]).toMatchObject({ t: 'header', h: { kind: 'text', id: 'k3f9' } });
    expect(packets()[0].p).toEqual({ ...textPacket, id: 'k3f9' });
  });

  it('strips 0x1F from fields', () => {
    const { feed, packets } = collect();
    feed(encodePacket({ ...textPacket, fromName: 'Al\x1fice', text: 'a\x1fb' }));
    expect(packets()[0].p.fromName).toBe('Alice');
    expect(packets()[0].p.text).toBe('ab');
  });

  it('rejects payloads over the limit', () => {
    expect(() => encodePacket({ ...textPacket, text: 'x'.repeat(MAX_PAYLOAD) })).toThrow(RangeError);
  });
});

describe('PacketParser', () => {
  it('round-trips text (with emoji), snap and 200-char packets', () => {
    const long: Packet = { ...textPacket, text: 'The quick brown fox 🦊 jumps over the lazy dog. '.repeat(5).slice(0, 200) };
    expect([...long.text].length).toBeGreaterThan(190);
    for (const p of [textPacket, snapPacket, long]) {
      const { feed, packets, parser } = collect();
      feed(encodePacket(p));
      expect(packets()).toEqual([{ t: 'packet', p, ok: true }]);
      expect(parser.inFrame).toBe(false);
    }
  });

  it('reports a CRC mismatch', () => {
    const bytes = encodePacket(textPacket);
    bytes[bytes.length - 3] ^= 0x01; // flip a bit in the last text byte
    const { feed, packets } = collect();
    feed(bytes);
    expect(packets()).toHaveLength(1);
    expect(packets()[0].ok).toBe(false);
    const bad = encodePacket(textPacket);
    bad[bad.length - 1] ^= 0xff; // corrupt the CRC itself
    const c2 = collect();
    c2.feed(bad);
    expect(c2.packets()[0]).toEqual({ t: 'packet', p: textPacket, ok: false });
  });

  it('emits frame start, then the header, then growing text, then the packet', () => {
    const { feed, events } = collect();
    feed(encodePacket(textPacket));
    expect(events[0].t).toBe('start');
    expect(events[1]).toEqual({ t: 'header', h: { kind: 'text', from: 'alice', fromName: 'Alice 🙂', to: ['bob', 'carol'], chatId: 'chat-alice-bob', mode: '' } });
    const chunks = events.filter((e): e is Extract<Ev, { t: 'text' }> => e.t === 'text').map((e) => e.s);
    expect(chunks.length).toBeGreaterThan(10);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startsWith(chunks[i - 1])).toBe(true);
      expect(chunks[i].length).toBeGreaterThan(chunks[i - 1].length);
    }
    expect(chunks.some((c) => c.includes('�'))).toBe(false); // emoji never split
    expect(chunks[chunks.length - 1]).toBe(textPacket.text);
    expect(events[events.length - 1].t).toBe('packet');
    expect(events.findIndex((e) => e.t === 'text')).toBeGreaterThan(1);
  });

  it('reports inFrame from the magic until the CRC', () => {
    const { parser } = collect();
    const bytes = encodePacket(snapPacket);
    const states = Array.from(bytes, (b) => {
      parser.pushByte(b);
      return parser.inFrame;
    });
    expect(states.slice(0, 2)).toEqual([false, false]);
    expect(states.slice(2, -1).every(Boolean)).toBe(true);
    expect(states[states.length - 1]).toBe(false);
  });

  it('resyncs on the magic after garbage and partial magics', () => {
    const { feed, packets } = collect();
    feed([0x00, 0xff, 0x53, 0x53, 0x43, 0x00, 0x53, 0x43, 0x53, 0x43]);
    feed([0x53, 0x53]); // more 'S' right before the real packet's magic
    feed(encodePacket(snapPacket));
    expect(packets()).toEqual([{ t: 'packet', p: snapPacket, ok: true }]);
  });

  it('drops frames with an impossible length and recovers', () => {
    const { feed, packets, parser } = collect();
    feed([0x53, 0x43, 0x01, 0x08, 0x01]); // LEN 2049
    expect(parser.inFrame).toBe(false);
    feed([0x53, 0x43, 0x01, 0x00, 0x02]); // LEN 2: too short for a header
    expect(parser.inFrame).toBe(false);
    feed(encodePacket(textPacket));
    expect(packets()).toEqual([{ t: 'packet', p: textPacket, ok: true }]);
  });

  it('decodes back-to-back packets and reset() drops a partial frame', () => {
    const { feed, packets, parser } = collect();
    const a = encodePacket(textPacket);
    feed(a.subarray(0, 12));
    expect(parser.inFrame).toBe(true);
    parser.reset();
    expect(parser.inFrame).toBe(false);
    feed(a);
    feed(encodePacket(snapPacket));
    expect(packets().map((e) => e.p)).toEqual([textPacket, snapPacket]);
  });
});
