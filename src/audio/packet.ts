// Stub: implemented by the FSK/packet agent. See docs/superpowers/specs/2026-11-21-audio-transport-design.md
export type PacketKind = 'text' | 'snap';
export interface PacketHeader {
  kind: PacketKind;
  from: string;
  fromName: string;
  to: string[];
  chatId: string;
  mode: string;
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
export function encodePacket(_p: Packet): Uint8Array {
  throw new Error('not implemented');
}
export function crc16(_bytes: Uint8Array): number {
  throw new Error('not implemented');
}
export class PacketParser {
  readonly inFrame: boolean = false;
  constructor(_events: PacketEvents) {}
  pushByte(_b: number): void {
    throw new Error('not implemented');
  }
  reset(): void {}
}
