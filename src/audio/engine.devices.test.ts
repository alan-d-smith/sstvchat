import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine } from './engine';

// Just enough Web Audio for the engine to open the mic (no AudioWorklet: ScriptProcessor path).
class FakeContext {
  sampleRate = 48000;
  state = 'running';
  currentTime = 0;
  destination = {};
  resume = async () => {};
  createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  createGain = () => ({ gain: { value: 1 }, connect: vi.fn() });
  createScriptProcessor = () => ({ connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null });
}

function fakeStream() {
  const track = { stop: vi.fn(), addEventListener: vi.fn(), label: 'mic', readyState: 'live', muted: false, getSettings: () => ({}) };
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream };
}

const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeContext);
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});

afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('audio engine microphone choice', () => {
  it('opens the system default mic with processing off when none is chosen', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    const engine = createAudioEngine({ micId: () => null });
    await engine.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0]).toEqual({ audio: RAW });
    expect(engine.state()).toBe('listening');
  });

  it('opens the chosen mic by exact deviceId, processing still off', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    const engine = createAudioEngine({ micId: () => 'usb-mic' });
    await engine.start();
    expect(getUserMedia.mock.calls[0][0]).toEqual({ audio: { ...RAW, deviceId: { exact: 'usb-mic' } } });
    expect(engine.state()).toBe('listening');
  });

  it('falls back to the default mic when the chosen one is gone', async () => {
    const overconstrained = Object.assign(new Error('gone'), { name: 'OverconstrainedError' });
    getUserMedia.mockRejectedValueOnce(overconstrained).mockResolvedValue(fakeStream().stream);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = createAudioEngine({ micId: () => 'unplugged' });
    await engine.start();
    warn.mockRestore();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: RAW });
    expect(engine.state()).toBe('listening');
  });

  it('does not retry another mic when access is denied', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    const engine = createAudioEngine({ micId: () => 'usb-mic' });
    await engine.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(engine.state()).toBe('denied');
  });

  it('restart() switches to the newly chosen mic and stops the old one', async () => {
    const first = fakeStream();
    const second = fakeStream();
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    let micId: string | null = null;
    const engine = createAudioEngine({ micId: () => micId });
    await engine.start();

    micId = 'usb-mic';
    await engine.restart!();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: { ...RAW, deviceId: { exact: 'usb-mic' } } });
    expect(first.track.stop).toHaveBeenCalled();
    expect(second.track.stop).not.toHaveBeenCalled();
    expect(engine.state()).toBe('listening');
  });

  it('restart() leaves a mic that was never started alone', async () => {
    const engine = createAudioEngine({ micId: () => 'usb-mic' });
    await engine.restart!();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(engine.state()).toBe('off');
  });
});
