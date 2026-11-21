import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useDeviceId } from '../state/devices';
import { getFilter } from './filters';
import type { SnapFilter } from './filters';

export type { SnapFilter } from './filters';

/** Snap size: always portrait 3:4. */
const W = 240;
const H = 320;

export type Facing = 'user' | 'environment';

/** CSS `filter` equivalent of a snap filter ('none' when it has none), for a plain <video>. */
export function filterCss(filter: SnapFilter): string {
  return getFilter(filter).css ?? 'none';
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;

/** Filter time in seconds; always 0 (a still frame of animated filters) for prefers-reduced-motion. */
export function snapTime(reduce = reducedMotion()): number {
  return reduce ? 0 : performance.now() / 1000;
}

/* ---------- capture ---------- */

/** Largest centred 3:4 portrait rectangle inside a w×h frame. */
export function portraitCrop(w: number, h: number) {
  const ratio = W / H;
  const sw = w / h > ratio ? h * ratio : w;
  const sh = w / h > ratio ? h : w / ratio;
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
}

/** Draws the centred 3:4 crop of a w×h source over a 240×320 context, mirrored if asked. */
function drawCrop(ctx: CanvasRenderingContext2D, source: CanvasImageSource, w: number, h: number, mirror: boolean) {
  if (!w || !h) throw new Error('snap source has no pixels yet');
  ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? W : 0, 0);
  const { sx, sy, sw, sh } = portraitCrop(w, h);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, W, H);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function snapContext(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('snaps need a 2D canvas');
  return ctx;
}

/**
 * The centred 3:4 portrait crop of a w×h source as a fresh 240×320 snap, mirrored if asked, run
 * through the filter at time `t`.
 */
function renderSnap(source: CanvasImageSource, w: number, h: number, filter: SnapFilter, mirror: boolean, t: number): ImageData {
  const ctx = snapContext();
  drawCrop(ctx, source, w, h, mirror);
  const src = ctx.getImageData(0, 0, W, H);
  if (filter === 'none') return src;
  const out = new ImageData(W, H);
  getFilter(filter).apply(src, out, t);
  return out;
}

/**
 * Grabs the current video frame as a 240×320 snap: centre-cropped to 3:4 portrait, filtered (at
 * time `t`, for animated filters), and mirrored when `mirror` is set (front camera, so the snap
 * matches the preview). Throws if the video has no frame yet or a 2D canvas is unavailable.
 */
export function captureSnap(video: HTMLVideoElement, filter: SnapFilter, { mirror = false, t = 0 } = {}): ImageData {
  return renderSnap(video, video.videoWidth, video.videoHeight, filter, mirror, t);
}

/** Decodes an image file (EXIF orientation applied), via createImageBitmap or an <img>. */
async function decodeImage(file: Blob): Promise<{ source: CanvasImageSource; w: number; h: number; done(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
    } catch {
      // Some formats or older engines: fall back to an <img>.
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('could not decode the image'));
    });
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return { source: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

/**
 * Turns a picture from the photo gallery into a 240×320 snap: centre-cropped to 3:4 portrait
 * with the filter applied (animated ones as at time `t`), ready for `takeSnap(image)`. Rejects if
 * the file can't be decoded.
 */
export async function imageFileToSnap(file: Blob, filter: SnapFilter, t = snapTime()): Promise<ImageData> {
  const { source, w, h, done } = await decodeImage(file);
  try {
    return renderSnap(source, w, h, filter, false, t);
  } finally {
    done();
  }
}

/* ---------- live camera ---------- */

export interface CameraState {
  /** Attach to the <video> that shows the viewfinder (keep it mounted while active). */
  videoRef: RefObject<HTMLVideoElement>;
  /** A frame is available: the shutter can capture from the video. */
  ready: boolean;
  /** Why there is no camera ('denied' / 'unavailable'); the UI keeps a black viewfinder. */
  error: string | null;
  /** Camera currently requested. */
  facing: Facing;
  /** Front camera (or a webcam that does not say): show and capture mirrored. */
  mirrored: boolean;
  /** Switch between the front ('user') and back ('environment') camera. */
  flip(): void;
}

/**
 * Streams the webcam into `videoRef` while `active` (getUserMedia, video only). Stops every track
 * when inactive or unmounted, and restarts on flip. Missing API, insecure context or a denied
 * permission all end in `error` with `ready` false — callers fall back to a placeholder snap.
 * The camera chosen in Settings is used (and switched to at once) until the user flips.
 */
export function useCamera(active: boolean): CameraState {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<Facing>('user');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState<Facing | null>(null);
  const chosen = useDeviceId('camera');
  /** The chosen camera the user flipped away from: facing decides until another is chosen. */
  const [flippedFrom, setFlippedFrom] = useState<string | null>(null);
  const deviceId = chosen && chosen !== flippedFrom ? chosen : null;

  useEffect(() => {
    if (!active) return;
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) {
      setError('unavailable');
      return;
    }
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let live = true;
    const onFrame = () => {
      if (live) setReady(true);
    };

    setError(null);
    const size = { width: { ideal: 1280 }, height: { ideal: 960 } };
    const byFacing = () => media.getUserMedia({ audio: false, video: { facingMode: facing, ...size } });
    const open = deviceId
      ? media.getUserMedia({ audio: false, video: { deviceId: { exact: deviceId }, ...size } }).catch((e: unknown) => {
        // The chosen camera is gone (unplugged, OverconstrainedError): the usual one instead.
        const name = (e as { name?: string })?.name;
        return name === 'NotAllowedError' || name === 'SecurityError' ? Promise.reject(e) : byFacing();
      })
      : byFacing();
    open
      .then((s) => {
        if (!live) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const settings = s.getVideoTracks()[0]?.getSettings?.();
        setReported(settings?.facingMode === 'user' || settings?.facingMode === 'environment' ? settings.facingMode : null);
        video = videoRef.current;
        if (!video) return;
        video.addEventListener('loadeddata', onFrame);
        video.srcObject = s;
        video.muted = true;
        video.playsInline = true;
        Promise.resolve(video.play?.()).catch(() => {});
        if (video.readyState >= 2) setReady(true);
      })
      .catch((e: unknown) => {
        if (!live) return;
        const name = (e as { name?: string })?.name;
        setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      });

    return () => {
      live = false;
      stream?.getTracks().forEach((t) => t.stop());
      if (video) {
        video.removeEventListener('loadeddata', onFrame);
        video.srcObject = null;
      }
      setReady(false);
    };
  }, [active, facing, deviceId]);

  const flip = useCallback(() => {
    if (deviceId) {
      // Off the chosen camera, to the side it is not on.
      setFlippedFrom(deviceId);
      setFacing((reported ?? facing) === 'user' ? 'environment' : 'user');
    } else {
      setFacing((f) => (f === 'user' ? 'environment' : 'user'));
    }
  }, [deviceId, reported, facing]);
  const mirrored = (reported ?? facing) === 'user';

  return { videoRef, ready, error, facing, mirrored, flip };
}

/* ---------- filtered viewfinder ---------- */

/** Filtered preview frames per second at most (cameras deliver about 30). */
const PREVIEW_FPS = 30;

export interface ViewfinderState {
  /** Attach to a 240×320 <canvas>: each camera frame is drawn there through the filter. */
  canvasRef: RefObject<HTMLCanvasElement>;
  /**
   * What to show: 'canvas' once a filtered frame is drawn; 'video' when there is no 2D canvas
   * (the video with the filter's CSS equivalent); 'off' while there is no camera frame.
   */
  shows: 'off' | 'canvas' | 'video';
  /**
   * The frame on screen as a fresh 240×320 snap through the current filter (the newest camera
   * frame, at the same animation time), or undefined with no usable frame — pass it straight to
   * `takeSnap`, which then falls back to a placeholder.
   */
  grab(): ImageData | undefined;
}

/**
 * Live filtered preview: while the camera has frames, draws each one (centre-cropped to 3:4 and
 * mirrored like the snap) into the 240×320 canvas and runs the filter over it — exactly the
 * pixels the shutter captures. Reuses one pixel buffer, draws at most 30 times a second, and
 * stops whenever the camera is released or the page is hidden. Animated filters hold still for
 * prefers-reduced-motion.
 */
export function useViewfinder(cam: Pick<CameraState, 'videoRef' | 'ready' | 'mirrored'>, filter: SnapFilter): ViewfinderState {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shows, setShows] = useState<ViewfinderState['shows']>('off');
  const latest = useRef({ filter, mirrored: cam.mirrored });
  latest.current = { filter, mirrored: cam.mirrored };
  /** Animation time of the frame on screen, so a capture keeps what the user sees. */
  const shownAt = useRef<number | null>(null);
  const { ready, videoRef, mirrored } = cam;

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!ready || !video || !canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      setShows('video');
      return () => setShows('off');
    }
    const out = new ImageData(W, H);
    const motion = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : null;
    let frame = 0;
    let last = -Infinity;
    let painted = false;

    const paint = (now: number) => {
      frame = requestAnimationFrame(paint);
      if (now - last < 1000 / PREVIEW_FPS - 4) return;
      last = now;
      const { filter: f, mirrored: m } = latest.current;
      const t = snapTime(motion?.matches ?? false);
      try {
        drawCrop(ctx, video, video.videoWidth, video.videoHeight, m);
        if (f !== 'none') {
          getFilter(f).apply(ctx.getImageData(0, 0, W, H), out, t);
          ctx.putImageData(out, 0, 0);
        }
      } catch {
        return; // No frame yet, or the stream just ended: try again next time.
      }
      shownAt.current = t;
      if (!painted) {
        painted = true;
        setShows('canvas');
      }
    };
    frame = requestAnimationFrame(paint);

    return () => {
      cancelAnimationFrame(frame);
      shownAt.current = null;
      setShows('off');
    };
  }, [ready, videoRef]);

  const grab = useCallback((): ImageData | undefined => {
    const video = videoRef.current;
    if (!ready || !video) return undefined;
    try {
      return captureSnap(video, filter, { mirror: mirrored, t: shownAt.current ?? snapTime() });
    } catch {
      return undefined;
    }
  }, [ready, videoRef, filter, mirrored]);

  return { canvasRef, shows, grab };
}
