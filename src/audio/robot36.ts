// Stub: implemented by the SSTV agent. See docs/superpowers/specs/2026-11-21-audio-transport-design.md
export const ROBOT36 = { width: 320, height: 240, visCode: 8, lineMs: 150 } as const;
export interface Robot36Events {
  onStart?(): void;
  onRow?(index: number, row: Uint8ClampedArray): void;
  onProgress?(p: number): void;
  onDone?(): void;
  onTimeout?(): void;
}
export function robot36Modulate(_landscape: ImageData, _sampleRate: number, _amplitude = 0.8): Float32Array {
  throw new Error('not implemented');
}
export function robot36DurationMs(): number {
  throw new Error('not implemented');
}
export class Robot36Receiver {
  readonly state: 'waiting-vis' | 'receiving' | 'done' | 'timeout' | 'aborted' = 'waiting-vis';
  constructor(_sampleRate: number, _events: Robot36Events, _opts?: { visTimeoutMs?: number }) {}
  push(_samples: Float32Array): void {
    throw new Error('not implemented');
  }
  abort(): void {}
}
