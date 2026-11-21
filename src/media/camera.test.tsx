import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { applyFilterPixels, captureSnap, filterCss, imageFileToSnap, portraitCrop, useCamera } from './camera';
import type { CameraState } from './camera';
import { saveDeviceId } from '../state/devices';

function fakeCtx(withFilter = true) {
  const ctx = {
    drawImage: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    getImageData: vi.fn(() => {
      const img = new ImageData(240, 320);
      img.data.set([255, 0, 0, 255]);
      return img;
    }),
  } as Record<string, unknown>;
  if (withFilter) ctx.filter = 'none';
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  return ctx as {
    drawImage: ReturnType<typeof vi.fn>; translate: ReturnType<typeof vi.fn>; scale: ReturnType<typeof vi.fn>;
    filter?: string;
  };
}

const video = (w: number, h: number) => ({ videoWidth: w, videoHeight: h }) as HTMLVideoElement;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('filters and cropping', () => {
  it('describes each filter as CSS', () => {
    expect(filterCss('none')).toBe('none');
    expect(filterCss('mono')).toBe('grayscale(1) contrast(1.15)');
    expect(filterCss('warm')).toBe('sepia(0.5) saturate(1.25) brightness(1.04)');
  });

  it('centre-crops landscape and portrait frames to 3:4 portrait', () => {
    expect(portraitCrop(1280, 720)).toEqual({ sx: 370, sy: 0, sw: 540, sh: 720 });
    expect(portraitCrop(720, 1280)).toEqual({ sx: 0, sy: 160, sw: 720, sh: 960 });
  });

  it('applies mono in software as an even grey', () => {
    const img = new ImageData(1, 1);
    img.data.set([255, 0, 0, 255]);
    applyFilterPixels(img, 'mono');
    const [r, g, b, a] = img.data;
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(35);
    expect(r).toBeLessThan(50);
    expect(a).toBe(255);
  });
});

describe('captureSnap', () => {
  it('draws the centred 3:4 crop through the filter', () => {
    const ctx = fakeCtx();
    const v = video(1280, 720);
    const img = captureSnap(v, 'mono');
    expect(ctx.filter).toBe('grayscale(1) contrast(1.15)');
    expect(ctx.drawImage).toHaveBeenCalledWith(v, 370, 0, 540, 720, 0, 0, 240, 320);
    expect(ctx.translate).not.toHaveBeenCalled();
    expect([img.width, img.height]).toEqual([240, 320]);
  });

  it('mirrors for the front camera', () => {
    const ctx = fakeCtx();
    captureSnap(video(640, 480), 'none', { mirror: true });
    expect(ctx.translate).toHaveBeenCalledWith(240, 0);
    expect(ctx.scale).toHaveBeenCalledWith(-1, 1);
  });

  it('filters the pixels itself when the context has no filter support', () => {
    fakeCtx(false);
    const img = captureSnap(video(640, 480), 'mono');
    expect(img.data[0]).toBe(img.data[1]);
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
    expect(ctx.filter).toBe('sepia(0.5) saturate(1.25) brightness(1.04)');
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 75, 0, 450, 600, 0, 0, 240, 320);
    expect(bitmap.close).toHaveBeenCalled();
    expect([img.width, img.height]).toEqual([240, 320]);
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
