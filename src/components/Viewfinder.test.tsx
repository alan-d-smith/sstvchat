import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useCamera, useViewfinder } from '../media/camera';
import type { ViewfinderState } from '../media/camera';
import { getFilter } from '../media/filters';
import type { SnapFilter } from '../media/filters';
import { Viewfinder } from './Viewfinder';

function redFrame() {
  const img = new ImageData(240, 320);
  img.data.set([255, 0, 0, 255]);
  return img;
}

let view: ViewfinderState;
function Probe({ filter }: { filter: SnapFilter }) {
  const cam = useCamera(true);
  view = useViewfinder(cam, filter);
  return <Viewfinder cam={cam} view={view} filter={filter} />;
}

describe('Viewfinder', () => {
  const ctx = {
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn(redFrame),
  };
  let frames: FrameRequestCallback[];
  let now: number;
  const tick = () => act(() => {
    now += 40;
    const due = frames;
    frames = [];
    due.forEach((cb) => cb(now));
  });
  let reduce: boolean;

  beforeEach(() => {
    frames = [];
    now = 1000;
    reduce = false;
    Object.values(ctx).forEach((f) => f.mockClear());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q.includes('reduced-motion') && reduce, media: q, addEventListener: () => {}, removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const track = { stop: vi.fn(), getSettings: () => ({ facingMode: 'user' }) };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  });

  async function start(filter: SnapFilter) {
    const utils = render(<Probe filter={filter} />);
    await act(async () => {});
    const video = utils.container.querySelector('video')!;
    Object.defineProperties(video, { videoWidth: { value: 640 }, videoHeight: { value: 480 } });
    await act(async () => {
      video.dispatchEvent(new Event('loadeddata'));
    });
    return { ...utils, video, canvas: utils.container.querySelector('canvas')! };
  }

  it('draws each camera frame through the filter onto the canvas, mirrored like the snap', async () => {
    const { video, canvas, rerender } = await start('mono');
    expect(canvas).toHaveAttribute('width', '240');
    expect(canvas).toHaveAttribute('height', '320');
    expect(canvas).not.toHaveClass('is-shown');

    tick();
    expect(ctx.setTransform).toHaveBeenCalledWith(-1, 0, 0, 1, 240, 0);
    expect(ctx.drawImage).toHaveBeenCalledWith(video, 140, 0, 360, 480, 0, 0, 240, 320);
    const shown = ctx.putImageData.mock.lastCall![0] as ImageData;
    expect(shown.data[0]).toBe(shown.data[1]);
    expect(shown.data[0]).toBeLessThan(60);
    expect(canvas).toHaveClass('is-shown');
    expect(video).not.toHaveClass('is-shown');

    // Normal: just the frame, no pixel pass.
    rerender(<Probe filter="none" />);
    ctx.putImageData.mockClear();
    ctx.getImageData.mockClear();
    tick();
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    expect(ctx.getImageData).not.toHaveBeenCalled();
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });

  it('reuses one pixel buffer from frame to frame', async () => {
    await start('comic');
    tick();
    tick();
    const [[a], [b]] = ctx.putImageData.mock.calls;
    expect(a).toBe(b);
  });

  it('shutter grabs the frame on screen through the selected filter, as a fresh image', async () => {
    const { rerender } = await start('mono');
    tick();
    rerender(<Probe filter="duotone" />);
    const snap = view.grab()!;
    expect([snap.width, snap.height]).toEqual([240, 320]);
    const want = new ImageData(240, 320);
    getFilter('duotone').apply(redFrame(), want, 0);
    expect(Array.from(snap.data.slice(0, 4))).toEqual(Array.from(want.data.slice(0, 4)));
    expect(snap).not.toBe(ctx.putImageData.mock.lastCall![0]);
  });

  it('holds animated filters still for prefers-reduced-motion', async () => {
    reduce = true;
    const glitch = getFilter('glitch');
    const apply = vi.spyOn(glitch, 'apply');
    await start('glitch');
    tick();
    tick();
    expect(apply.mock.calls.map((c) => c[2])).toEqual([0, 0]);
  });

  it('animates them otherwise', async () => {
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const apply = vi.spyOn(getFilter('scanline'), 'apply');
    await start('scanline');
    tick();
    tick();
    expect(apply.mock.calls.map((c) => c[2])).toEqual([1.04, 1.08]);
  });

  it('stops drawing when the camera is released', async () => {
    const { unmount } = await start('thermal');
    tick();
    unmount();
    expect(frames).toHaveLength(0);
  });

  it('shows the plain video with the CSS filter when there is no 2D canvas', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { video, canvas } = await start('mono');
    expect(video).toHaveClass('is-shown');
    expect(video.style.filter).toBe('grayscale(1) contrast(1.15)');
    expect(canvas).not.toHaveClass('is-shown');
  });
});
