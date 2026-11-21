// Packet framing carried by the FSK modem.
// See docs/superpowers/specs/2026-11-21-audio-transport-design.md ("Packet").
//
//   'S' 'C' 0x01  LEN_hi LEN_lo  PAYLOAD[LEN]  CRC_hi CRC_lo
//
// PAYLOAD = UTF-8 fields joined by 0x1F: kind · from · fromName · to(comma-joined) · chatId · mode · id · text.
// `id` is a short per-message id so a receiver can drop a repeat of the same transmission.
// CRC = CRC-16/CCITT-FALSE over PAYLOAD.

export type PacketKind = 'text' | 'snap';
export interface PacketHeader {
  kind: PacketKind;
  from: string;
  fromName: string;
  to: string[];
  chatId: string;
  mode: string;
  /** Per-message id (same sender + same id = the same message heard twice). Empty/absent: none. */
  id?: string;
}
export interface Packet extends PacketHeader {
  text: string;
}
export interface PacketEvents {
  onFrameStart?(): void;
  onHeader?(h: PacketHeader): void;
  onTextChunk?(textSoFar: string): void;
  onPacket?(p: Packet, crcOk: boolean): void;
}

export const PACKET_MAGIC = [0x53, 0x43, 0x01] as const; // 'S' 'C' 0x01
export const FIELD_SEP = 0x1f;
/** Largest payload the parser accepts (and the encoder produces). */
export const MAX_PAYLOAD = 2048;
/** Bytes on the wire around the payload: magic(3) + len(2) + crc(2). */
export const PACKET_OVERHEAD = 7;

const HEADER_FIELDS = 7; // fields before `text`
const MIN_PAYLOAD = HEADER_FIELDS + 1; // kind char + 7 separators

const encoder = new TextEncoder();

function clean(s: string): string {
  return s.replace(/\x1f/g, '');
}

/** Encodes a packet. Throws RangeError if the payload exceeds MAX_PAYLOAD bytes. */
export function encodePacket(p: Packet): Uint8Array {
  const to = p.to.map((id) => clean(id).replace(/,/g, '')).filter((id) => id.length > 0);
  const fields = [
    p.kind === 'snap' ? 'S' : 'T',
    clean(p.from),
    clean(p.fromName),
    to.join(','),
    clean(p.chatId),
    clean(p.mode),
    clean(p.id ?? ''),
    clean(p.text),
  ];
  const payload = encoder.encode(fields.join('\x1f'));
  if (payload.length > MAX_PAYLOAD) {
    throw new RangeError(`packet payload ${payload.length} B exceeds ${MAX_PAYLOAD} B`);
  }
  const out = new Uint8Array(payload.length + PACKET_OVERHEAD);
  out.set(PACKET_MAGIC, 0);
  out[3] = payload.length >> 8;
  out[4] = payload.length & 0xff;
  out.set(payload, 5);
  const crc = crc16(payload);
  out[5 + payload.length] = crc >> 8;
  out[6 + payload.length] = crc & 0xff;
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    t[i] = c;
  }
  return t;
})();

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, xorout 0). */
export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) & 0xffff) ^ CRC_TABLE[((crc >> 8) ^ bytes[i]) & 0xff];
  return crc;
}

// Parser states.
const St = { Magic0: 0, Magic1: 1, Magic2: 2, Len0: 3, Len1: 4, Payload: 5, Crc0: 6, Crc1: 7 } as const;

/** Incremental parser: feed it bytes one at a time; it resyncs on the magic. */
export class PacketParser {
  private st: number = St.Magic0;
  private len = 0;
  private payload = new Uint8Array(MAX_PAYLOAD);
  private pos = 0;
  private crcHi = 0;
  private seps = 0;
  private header: PacketHeader | null = null;
  private textStart = 0;
  private text = '';
  private decoder = new TextDecoder();

  constructor(private readonly events: PacketEvents) {}

  /** True once the magic has been seen, until the packet completes or the frame is dropped. */
  get inFrame(): boolean {
    return this.st >= St.Len0;
  }

  reset(): void {
    this.st = St.Magic0;
    this.len = 0;
    this.pos = 0;
    this.seps = 0;
    this.header = null;
    this.text = '';
  }

  pushByte(b: number): void {
    b &= 0xff;
    switch (this.st) {
      case St.Magic0:
        if (b === PACKET_MAGIC[0]) this.st = St.Magic1;
        return;
      case St.Magic1:
        if (b === PACKET_MAGIC[1]) this.st = St.Magic2;
        else if (b !== PACKET_MAGIC[0]) this.st = St.Magic0;
        return;
      case St.Magic2:
        if (b === PACKET_MAGIC[2]) {
          this.reset();
          this.st = St.Len0;
          this.events.onFrameStart?.();
        } else {
          this.st = b === PACKET_MAGIC[0] ? St.Magic1 : St.Magic0;
        }
        return;
      case St.Len0:
        this.len = b << 8;
        this.st = St.Len1;
        return;
      case St.Len1:
        this.len |= b;
        if (this.len > MAX_PAYLOAD || this.len < MIN_PAYLOAD) this.reset();
        else this.st = St.Payload;
        return;
      case St.Payload:
        this.payloadByte(b);
        return;
      case St.Crc0:
        this.crcHi = b;
        this.st = St.Crc1;
        return;
      case St.Crc1:
        this.finish(((this.crcHi << 8) | b) === crc16(this.payload.subarray(0, this.len)));
        return;
    }
  }

  private payloadByte(b: number): void {
    this.payload[this.pos++] = b;
    if (this.header) {
      const chunk = this.decoder.decode(this.payload.subarray(this.pos - 1, this.pos), { stream: true });
      if (chunk) {
        this.text += chunk;
        this.events.onTextChunk?.(this.text);
      }
    } else if (b === FIELD_SEP && ++this.seps === HEADER_FIELDS) {
      const header = this.parseHeader();
      if (!header) {
        this.reset();
        return;
      }
      this.header = header;
      this.textStart = this.pos;
      this.decoder = new TextDecoder();
      this.events.onHeader?.(header);
    }
    if (this.pos === this.len) {
      if (this.header) this.st = St.Crc0;
      else this.reset(); // payload ended before the header was complete
    }
  }

  private parseHeader(): PacketHeader | null {
    const fields: string[] = [];
    const dec = new TextDecoder();
    let start = 0;
    for (let i = 0; i < this.pos; i++) {
      if (this.payload[i] === FIELD_SEP) {
        fields.push(dec.decode(this.payload.subarray(start, i)));
        start = i + 1;
      }
    }
    const kind = fields[0] === 'T' ? 'text' : fields[0] === 'S' ? 'snap' : null;
    if (!kind) return null;
    return {
      kind,
      from: fields[1],
      fromName: fields[2],
      to: fields[3].split(',').filter((id) => id.length > 0),
      chatId: fields[4],
      mode: fields[5],
      ...(fields[6] ? { id: fields[6] } : {}),
    };
  }

  private finish(crcOk: boolean): void {
    const header = this.header!;
    const tail = this.decoder.decode();
    if (tail) {
      this.text += tail;
      this.events.onTextChunk?.(this.text);
    }
    // Decode the whole text in one go so the delivered packet never depends on streaming state.
    const text = new TextDecoder().decode(this.payload.subarray(this.textStart, this.len));
    this.reset();
    this.events.onPacket?.({ ...header, text }, crcOk);
  }
}
