// Stub: implemented by the FSK/packet agent. See docs/superpowers/specs/2026-11-21-audio-transport-design.md
import type { PacketEvents } from './packet';

export const FSK = { mark: 1200, space: 2200, baud: 100, leadInMs: 300, tailMs: 60 } as const;
export interface FskEvents extends PacketEvents {
  onAbort?(): void;
}
export function fskModulate(_bytes: Uint8Array, _sampleRate: number, _amplitude = 0.8): Float32Array {
  throw new Error('not implemented');
}
export function fskDurationMs(_byteCount: number): number {
  throw new Error('not implemented');
}
export class FskReceiver {
  readonly busy: boolean = false;
  constructor(_sampleRate: number, _events: FskEvents) {}
  push(_samples: Float32Array): void {
    throw new Error('not implemented');
  }
  reset(): void {}
}
