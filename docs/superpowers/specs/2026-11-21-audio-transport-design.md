# SSTV Chat — real audio transport (phase 2)

Date: 2026-11-21. Extends `2026-11-21-sstvchat-ui-design.md`.

## What the user asked for

1. Text messages travel as **two-tone digital** (binary FSK) audio.
2. Snaps travel as **SSTV** audio. Flow: pick a filter by sliding the lens circles
   at the bottom of the camera (2 basic filters + none) → take a photo → send.
3. Sending a snap first transmits a **two-tone header saying who it is from and to**,
   then the SSTV image.
4. The receiving device keeps its **mic always on**. When it decodes a header
   addressed to its user, it accepts automatically and starts recording/decoding
   the image.

## Decisions (controller calls)

- **Identity, no accounts:** each device picks who it is (name → id slug), stored in
  `localStorage` (`sstv.self`). First run shows a small "Who are you?" picker that
  lists the mock people plus a free-text name. Addressing uses these ids.
  Chats keep the shared mock ids, so two devices with the same build can route by
  `chatId`; unknown senders get a new 1:1 chat.
- **Mic on:** browsers need a user gesture. The radio starts on the first tap/click
  anywhere (or the radio pill), asks for mic permission, then listens until the tab
  closes. A small radio pill shows `Listening` / `Sending` / `Mic off`.
  Echo cancellation, noise suppression and auto-gain are disabled.
- **Half duplex:** while the device transmits, mic samples are discarded.
- **Mock data stays:** mock chats and the Shift+D demo still use the mock transport
  (`simulateIncoming` delegates to it). Real traffic goes through audio.

## Wire formats

### Packet (bytes, carried by FSK)

```
'S' 'C'  0x01  LEN_hi LEN_lo  PAYLOAD[LEN]  CRC_hi CRC_lo
```

- PAYLOAD = UTF-8 fields joined by 0x1F, in this order:
  `kind` (`T` text | `S` snap) · `from` id · `fromName` (empty when it equals `from`) ·
  `to` ids comma-joined · `chatId` · `mode` (`Robot36` for snaps, empty for text) ·
  `id` (4 random base-36 chars per message) · `text` (last; empty for snaps).
- Receivers drop packets whose `from` is their own id (own transmission leaking into the mic)
  and any packet whose `from` + `id` they already received in the last hour, remembered across reloads (a looped
  recording or echo of the same transmission); two sends of the same words have different ids.
  Fields never contain 0x1F (stripped on encode).
- Text is last so the receiver can show it as it arrives.
- CRC = CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over PAYLOAD.

### Two-tone FSK

- Mark (1) = **1200 Hz**, space (0) = **2200 Hz**, **100 baud**.
- Lead-in: 300 ms of mark. Each byte: UART framing — 1 start bit (space), 8 data bits
  LSB first, 1 stop bit (mark). Tail: 60 ms mark. Continuous phase, 5 ms fade in/out.
- Receiver: sliding Goertzel energies for both tones over a one-bit window, hop ≈ 1/8
  bit, UART state machine (start-bit edge → sample bit centres), magic `SC` sync, length,
  CRC. Abort a frame if no start bit arrives within 3 byte-times.

### SSTV (Robot36, VIS code 8)

- Image is the portrait 240×320 snap rotated 90° CW into a 320×240 frame (`rotateCW`).
- VIS: 1900 Hz 300 ms, 1200 Hz 10 ms, 1900 Hz 300 ms, start bit 1200 Hz 30 ms, 7 data bits
  LSB first (1100 Hz = 1, 1300 Hz = 0) 30 ms each, even parity bit 30 ms, stop 1200 Hz 30 ms.
- Each of 240 lines, 150 ms: sync 1200 Hz 9 ms, porch 1500 Hz 3 ms, Y 88 ms (320 px),
  separator 4.5 ms (1500 Hz on even lines = R−Y follows, 2300 Hz on odd lines = B−Y follows),
  porch 1900 Hz 1.5 ms, chroma 44 ms (320 px). 1500 Hz = 0, 2300 Hz = 255. BT.601 YCbCr.
  Each even/odd pair shares chroma; both rows are emitted after the odd line.
- Receiver: complex mix at 1900 Hz → low-pass → phase-difference frequency estimate; VIS
  detection; per-line sync search around the expected position (corrects clock drift).
- Snap send = FSK packet (`kind S`) + 300 ms silence + VIS + lines (≈ 37 s + header).

## Module interfaces (pinned)

```ts
// src/audio/packet.ts
export type PacketKind = 'text' | 'snap';
export interface PacketHeader { kind: PacketKind; from: string; fromName: string; to: string[]; chatId: string; mode: string; id?: string }
export interface Packet extends PacketHeader { text: string }
export function encodePacket(p: Packet): Uint8Array;
export function crc16(bytes: Uint8Array): number;
export class PacketParser {                       // incremental, fed one byte at a time
  constructor(events: { onFrameStart?(): void; onHeader?(h: PacketHeader): void; onTextChunk?(textSoFar: string): void; onPacket?(p: Packet, crcOk: boolean): void });
  pushByte(b: number): void;                       // handles magic sync, length, fields, CRC
  reset(): void;
  readonly inFrame: boolean;
}

// src/audio/fsk.ts
export const FSK: { mark: 1200; space: 2200; baud: 100; leadInMs: 300; tailMs: 60 };
export function fskModulate(bytes: Uint8Array, sampleRate: number, amplitude?: number): Float32Array;
export function fskDurationMs(byteCount: number): number;
export class FskReceiver {                         // samples → bytes → PacketParser events
  constructor(sampleRate: number, events: { onFrameStart?(): void; onHeader?(h: PacketHeader): void; onTextChunk?(t: string): void; onPacket?(p: Packet, crcOk: boolean): void; onAbort?(): void });
  push(samples: Float32Array): void;
  reset(): void;
  readonly busy: boolean;                           // inside a frame
}

// src/audio/robot36.ts
export const ROBOT36: { width: 320; height: 240; visCode: 8; lineMs: 150 };
export function robot36Modulate(landscape: ImageData, sampleRate: number, amplitude?: number): Float32Array;
export function robot36DurationMs(): number;
export class Robot36Receiver {
  constructor(sampleRate: number, events: { onStart?(): void; onRow?(index: number, row: Uint8ClampedArray): void; onProgress?(p: number): void; onDone?(): void; onTimeout?(): void }, opts?: { visTimeoutMs?: number });
  push(samples: Float32Array): void;
  abort(): void;
  readonly state: 'waiting-vis' | 'receiving' | 'done' | 'timeout' | 'aborted';
}

// src/audio/engine.ts
export type RadioState = 'off' | 'starting' | 'listening' | 'transmitting' | 'denied' | 'error';
export interface AudioEngine {
  readonly sampleRate: number;
  state(): RadioState;
  start(): Promise<void>;
  onState(fn: (s: RadioState) => void): () => void;
  onSamples(fn: (chunk: Float32Array) => void): () => void;   // mic; nothing while transmitting
  play(samples: Float32Array, onProgress?: (p: number) => void): { done: Promise<void>; stop(): void };
}
export function createAudioEngine(): AudioEngine;

// src/audio/audioTransport.ts
export interface Identity { id: string; name: string }
export function createAudioTransport(opts: {
  engine: AudioEngine;
  self: () => Identity;
  recipients: (chatIds: string[]) => string[];   // person ids for those chats, excluding self
  fallback: Transport;                            // mock transport, used by simulateIncoming
}): Transport;
```

`TransportEvents['rx:start']` gains an optional 5th argument
`meta?: { fromName?: string; chatId?: string }`.

## Tests that prove it

- Packet: encode → parse round trip (incl. emoji text), CRC mismatch reported, header
  emitted before text, text chunks grow.
- FSK loopback: modulate at 48 kHz → add 500 ms silence, scale ×0.3, white noise
  (SNR ≈ 15 dB) → resample to 44.1 kHz → FskReceiver yields the identical packet.
- Robot36 loopback: same impairments; VIS detected, 240 rows, mean absolute error per
  channel < 16 on a test image with flat colour blocks.
- Audio transport: with a fake engine that loops `play` output into `onSamples`
  (another instance), text and snap are delivered only to the addressed identity.
