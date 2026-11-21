import { describe, expect, it, vi } from 'vitest';
import { createAudioEngine, hasWebAudio } from './engine';

// The engine is browser-only (AudioContext, AudioWorklet, getUserMedia); jsdom has none of them,
// so only the no-audio behaviour is checked here.
describe('audio engine without Web Audio', () => {
  it('starts off and reports an error when started', async () => {
    expect(hasWebAudio()).toBe(false);
    const engine = createAudioEngine();
    const states: string[] = [];
    engine.onState((s) => states.push(s));
    expect(engine.state()).toBe('off');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await engine.start();
    err.mockRestore();
    expect(states).toEqual(['starting', 'error']);
    expect(engine.state()).toBe('error');
  });

  it('rejects playback instead of hanging', async () => {
    const engine = createAudioEngine();
    await expect(engine.play(new Float32Array(10)).done).rejects.toThrow();
  });
});
