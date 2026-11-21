import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEVICE_KEYS, listDevices, loadDeviceId, loadMicId, saveDeviceId, unlockLabels } from './devices';

const device = (kind: MediaDeviceKind, deviceId: string, label = '') =>
  ({ kind, deviceId, label, groupId: '' }) as MediaDeviceInfo;

function mockMedia(media: Partial<MediaDevices>) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
}

afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  vi.restoreAllMocks();
});

describe('device preferences', () => {
  it('saves the chosen mic and camera under sstv.micId / sstv.cameraId', () => {
    expect(loadDeviceId('mic')).toBeNull();
    saveDeviceId('mic', 'usb-mic');
    saveDeviceId('camera', 'cam-2');
    expect(localStorage.getItem('sstv.micId')).toBe('usb-mic');
    expect(localStorage.getItem('sstv.cameraId')).toBe('cam-2');
    expect(loadMicId()).toBe('usb-mic');
    expect(loadDeviceId('camera')).toBe('cam-2');
  });

  it('"Default" (null) forgets the choice', () => {
    saveDeviceId('mic', 'usb-mic');
    saveDeviceId('mic', null);
    expect(localStorage.getItem(DEVICE_KEYS.mic)).toBeNull();
    expect(loadMicId()).toBeNull();
  });

  it('keeps working when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveDeviceId('camera', 'x')).not.toThrow();
    expect(loadDeviceId('camera')).toBeNull();
  });
});

describe('listDevices', () => {
  it('lists named microphones and cameras, without the default/communications aliases', async () => {
    mockMedia({
      enumerateDevices: vi.fn().mockResolvedValue([
        device('audioinput', 'default', 'Default - Built-in'),
        device('audioinput', 'communications', 'Communications - Built-in'),
        device('audioinput', 'a1', 'Built-in Microphone'),
        device('audioinput', 'a2', 'USB Microphone'),
        device('audiooutput', 'o1', 'Speakers'),
        device('videoinput', 'v1', 'FaceTime HD Camera'),
      ]),
    });
    const lists = await listDevices();
    expect(lists.mics).toEqual([{ id: 'a1', label: 'Built-in Microphone' }, { id: 'a2', label: 'USB Microphone' }]);
    expect(lists.cameras).toEqual([{ id: 'v1', label: 'FaceTime HD Camera' }]);
    expect(lists.locked).toEqual({ mic: false, camera: false });
  });

  it('numbers devices whose names are hidden and says access is needed', async () => {
    mockMedia({
      enumerateDevices: vi.fn().mockResolvedValue([
        device('audioinput', 'a1'),
        device('audioinput', 'a2'),
        device('videoinput', ''),
      ]),
    });
    const lists = await listDevices();
    expect(lists.mics.map((d) => d.label)).toEqual(['Microphone 1', 'Microphone 2']);
    // No id yet (Chrome before permission): nothing to choose.
    expect(lists.cameras).toEqual([]);
    expect(lists.locked).toEqual({ mic: true, camera: true });
  });

  it('is empty without the API', async () => {
    expect(await listDevices()).toEqual({ mics: [], cameras: [], locked: { mic: false, camera: false } });
  });
});

describe('unlockLabels', () => {
  it('asks once for raw mic audio and the camera, then stops the tracks', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }, { stop }] });
    mockMedia({ getUserMedia });
    await unlockLabels({ mic: true, camera: true });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0]).toEqual({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: true,
    });
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('asks for each on its own when one of them fails', async () => {
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new Error('NotFoundError'))
      .mockResolvedValue({ getTracks: () => [] });
    mockMedia({ getUserMedia });
    await unlockLabels({ mic: true, camera: true });
    expect(getUserMedia).toHaveBeenCalledTimes(3);
  });
});
