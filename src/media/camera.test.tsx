import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { captureSnap, filterCss, imageFileToSnap, portraitCrop, snapTime, useCamera } from './camera';
import type { CameraState } from './camera';
import { getFilter } from './filters';
import type { SnapFilter } from './filters';
import { saveDeviceId } from '../state/devices';

/** A 240×320 frame whose first pixel is pure red. */
function redFrame() {
  const img = new ImageData(240, 320);
  img.data.set([255, 0, 0, 255]);
  return img;
}

function fakeCtx() {
  const ctx = {
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn(redFrame),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  return ctx;
}

/** The first pixel of a red frame through `filter` at time `t`. */
function expected(filter: SnapFilter, t = 0) {
  const out = new ImageData(240, 320);
  getFilter(filter).apply(redFrame(), out, t);
  return Array.from(out.data.slice(0, 4));
}

const video = (w: number, h: number) => ({ videoWidth: w, videoHeight: h }) as HTMLVideoElement;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('filters and cropping', () => {
  it('gives the CSS equivalent of a filter for the plain-video fallback', () => {
    expect(filterCss('none')).toBe('none');
    expect(filterCss('mono')).toBe('grayscale(1) contrast(1.15)');
    expect(filterCss('warm')).toBe('sepia(0.5) saturate(1.25) brightness(1.04)');
    expect(filterCss('thermal')).toBe('none');
  });

  it('centre-crops landscape and portrait frames to 3:4 portrait', () => {
    expect(portraitCrop(1280, 720)).toEqual({ sx: 370, sy: 0, sw: 540, sh: 720 });
    expect(portraitCrop(720, 1280)).toEqual({ sx: 0, sy: 160, sw: 720, sh: 960 });
  });

  it('holds animated filters still for prefers-reduced-motion', () => {
    expect(snapTime(true)).toBe(0);
    expect(snapTime(false)).toBeGreaterThan(0);
    const saved = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    try {
      expect(snapTime()).toBe(0);
      expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    } finally {
      window.matchMedia = saved;
    }
  });
});

describe('captureSnap', () => {
  it('draws the centred 3:4 crop and runs the selected filter over it', () => {
    const ctx = fakeCtx();
    const v = video(1280, 720);
    const img = captureSnap(v, 'mono');
    expect(ctx.drawImage).toHaveBeenCalledWith(v, 370, 0, 540, 720, 0, 0, 240, 320);
    expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
    expect([img.width, img.height]).toEqual([240, 320]);
    const [r, g, b] = img.data;
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(Array.from(img.data.slice(0, 4))).toEqual(expected('mono'));
  });

  it('returns the plain frame for Normal', () => {
    fakeCtx();
    expect(Array.from(captureSnap(video(640, 480), 'none').data.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it('runs animated filters at the given time', () => {
    fakeCtx();
    const img = captureSnap(video(640, 480), 'glitch', { t: 2 });
    expect(Array.from(img.data.slice(0, 4))).toEqual(expected('glitch', 2));
  });

  it('mirrors for the front camera', () => {
    const ctx = fakeCtx();
    captureSnap(video(640, 480), 'none', { mirror: true });
    expect(ctx.setTransform).toHaveBeenCalledWith(-1, 0, 0, 1, 240, 0);
  });

  it('throws while the video has no frame', () => {
    fakeCtx();
    expect(() => captureSnap(video(0, 0), 'none')).toThrow();
  });
});

describe('imageFileToSnap', () => {
  it('decodes the file, crops it to 3:4 and applies the filter', async () => {
    const ctx = fakeCtx();
    const bitmap = { width: 600, height: 600, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const img = await imageFileToSnap(new Blob(['x'], { type: 'image/png' }), 'warm');
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 75, 0, 450, 600, 0, 0, 240, 320);
    expect(bitmap.close).toHaveBeenCalled();
    expect([img.width, img.height]).toEqual([240, 320]);
    expect(Array.from(img.data.slice(0, 4))).toEqual(expected('warm'));
  });

  it('applies the new pixel filters too', async () => {
    fakeCtx();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 300, height: 400, close: vi.fn() }));
    const img = await imageFileToSnap(new Blob(['x'], { type: 'image/png' }), 'duotone', 0);
    expect(Array.from(img.data.slice(0, 4))).toEqual(expected('duotone'));
  });
});

describe('useCamera', () => {
  let cam: CameraState;
  function Probe({ active }: { active: boolean }) {
    cam = useCamera(active);
    return <video ref={cam.videoRef} />;
  }

  const stream = () => {
    const track = { stop: vi.fn(), getSettings: () => ({}) };
    return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream };
  };

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  });

  const mockMedia = (getUserMedia: ReturnType<typeof vi.fn>) =>
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });

  it('streams the front camera, flips, and stops tracks when done', async () => {
    const a = stream();
    const b = stream();
    const gum = vi.fn().mockResolvedValueOnce(a.stream).mockResolvedValueOnce(b.stream);
    mockMedia(gum);

    const { container, unmount } = render(<Probe active />);
    await act(async () => {});
    expect(gum.mock.calls[0][0].video.facingMode).toBe('user');
    const el = container.querySelector('video')!;
    expect(el.srcObject).toBe(a.stream);
    expect(cam.mirrored).toBe(true);

    await act(async () => {
      el.dispatchEvent(new Event('loadeddata'));
    });
    expect(cam.ready).toBe(true);

    await act(async () => cam.flip());
    expect(a.track.stop).toHaveBeenCalled();
    expect(gum.mock.calls[1][0].video.facingMode).toBe('environment');
    expect(cam.mirrored).toBe(false);

    unmount();
    expect(b.track.stop).toHaveBeenCalled();
  });

  it('opens the camera chosen in Settings, switches when it changes, and flips away from it', async () => {
    localStorage.setItem('sstv.cameraId', 'desk-cam');
    const a = stream();
    const b = stream();
    const c = stream();
    const gum = vi.fn().mockResolvedValueOnce(a.stream).mockResolvedValueOnce(b.stream).mockResolvedValueOnce(c.stream);
    mockMedia(gum);

    render(<Probe active />);
    await act(async () => {});
    expect(gum.mock.calls[0][0].video.deviceId).toEqual({ exact: 'desk-cam' });
    expect(gum.mock.calls[0][0].video.facingMode).toBeUndefined();

    // Chosen while the camera is open: switches at once.
    await act(async () => saveDeviceId('camera', 'usb-cam'));
    expect(a.track.stop).toHaveBeenCalled();
    expect(gum.mock.calls[1][0].video.deviceId).toEqual({ exact: 'usb-cam' });

    await act(async () => cam.flip());
    expect(b.track.stop).toHaveBeenCalled();
    expect(gum.mock.calls[2][0].video.deviceId).toBeUndefined();
    expect(gum.mock.calls[2][0].video.facingMode).toBe('environment');
  });

  it('falls back to facingMode when the chosen camera is gone', async () => {
    localStorage.setItem('sstv.cameraId', 'unplugged');
    const a = stream();
    const gum = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'OverconstrainedError' }))
      .mockResolvedValueOnce(a.stream);
    mockMedia(gum);
    const { container } = render(<Probe active />);
    await act(async () => {});
    expect(gum).toHaveBeenCalledTimes(2);
    expect(gum.mock.calls[1][0].video.facingMode).toBe('user');
    expect(container.querySelector('video')!.srcObject).toBe(a.stream);
    expect(cam.error).toBeNull();
  });

  it('does not ask for the camera while inactive', async () => {
    const gum = vi.fn();
    mockMedia(gum);
    render(<Probe active={false} />);
    await act(async () => {});
    expect(gum).not.toHaveBeenCalled();
  });

  it('reports a denied permission', async () => {
    mockMedia(vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' })));
    render(<Probe active />);
    await act(async () => {});
    expect(cam.error).toBe('denied');
    expect(cam.ready).toBe(false);
  });

  it('reports a missing camera API', async () => {
    render(<Probe active />);
    await act(async () => {});
    expect(cam.error).toBe('unavailable');
  });
});
