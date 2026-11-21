import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useDeviceId } from '../state/devices';

/** Snap size: always portrait 3:4. */
const W = 240;
const H = 320;

export type SnapFilter = 'none' | 'mono' | 'warm';
export type Facing = 'user' | 'environment';

type Op = readonly ['grayscale' | 'sepia' | 'saturate' | 'contrast' | 'brightness', number];

/** Each filter as CSS filter functions, so the live video and the capture use the same recipe. */
const OPS: Record<SnapFilter, readonly Op[]> = {
  none: [],
  mono: [['grayscale', 1], ['contrast', 1.15]],
  warm: [['sepia', 0.5], ['saturate', 1.25], ['brightness', 1.04]],
};

export const SNAP_FILTERS: readonly { id: SnapFilter; name: string }[] = [
  { id: 'none', name: 'Normal' },
  { id: 'mono', name: 'Mono' },
  { id: 'warm', name: 'Warm' },
];

/** CSS `filter` value for a snap filter (also valid for a 2D canvas context's `filter`). */
export function filterCss(filter: SnapFilter): string {
  const ops = OPS[filter];
  return ops.length ? ops.map(([fn, v]) => `${fn}(${v})`).join(' ') : 'none';
}

/* ---------- capture ---------- */

/** 3×3 colour matrix plus offset, in 0–255 space (the Filter Effects definitions). */
type Affine = { m: number[]; o: number[] };

function opAffine([fn, v]: Op): Affine {
  switch (fn) {
    case 'grayscale': {
      const a = 1 - v;
      return {
        m: [
          0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a,
          0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a,
          0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a,
        ],
        o: [0, 0, 0],
      };
    }
    case 'sepia': {
      const a = 1 - v;
      return {
        m: [
          0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a,
          0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a,
          0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a,
        ],
        o: [0, 0, 0],
      };
    }
    case 'saturate':
      return {
        m: [
          0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v,
          0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v,
          0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v,
        ],
        o: [0, 0, 0],
      };
    case 'contrast': {
      const off = (0.5 - 0.5 * v) * 255;
      return { m: [v, 0, 0, 0, v, 0, 0, 0, v], o: [off, off, off] };
    }
    case 'brightness':
      return { m: [v, 0, 0, 0, v, 0, 0, 0, v], o: [0, 0, 0] };
  }
}

/**
 * Applies a filter to pixels in place. Used where a 2D context ignores `ctx.filter` (older
 * Safari). Each step clamps to 0–255 like the browser's own per-function pipeline.
 */
export function applyFilterPixels(img: ImageData, filter: SnapFilter): ImageData {
  const steps = OPS[filter].map(opAffine);
  if (!steps.length) return img;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];
    for (const { m, o } of steps) {
      const nr = m[0] * r + m[1] * g + m[2] * b + o[0];
      const ng = m[3] * r + m[4] * g + m[5] * b + o[1];
      const nb = m[6] * r + m[7] * g + m[8] * b + o[2];
      r = Math.min(255, Math.max(0, nr));
      g = Math.min(255, Math.max(0, ng));
      b = Math.min(255, Math.max(0, nb));
    }
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
  return img;
}

/** Largest centred 3:4 portrait rectangle inside a w×h frame. */
export function portraitCrop(w: number, h: number) {
  const ratio = W / H;
  const sw = w / h > ratio ? h * ratio : w;
  const sh = w / h > ratio ? h : w / ratio;
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
}

/**
 * Draws the centred 3:4 portrait crop of a w×h source into a fresh 240×320 canvas through the
 * filter (mirrored if asked) and returns the pixels.
 */
function drawSnap(source: CanvasImageSource, w: number, h: number, filter: SnapFilter, mirror: boolean): ImageData {
  if (!w || !h) throw new Error('snap source has no pixels yet');
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('snaps need a 2D canvas');

  const native = typeof ctx.filter === 'string';
  if (native) ctx.filter = filterCss(filter);
  if (mirror) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  const { sx, sy, sw, sh } = portraitCrop(w, h);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  return native ? img : applyFilterPixels(img, filter);
}

/**
 * Grabs the current video frame as a 240×320 snap: centre-cropped to 3:4 portrait, filtered,
 * and mirrored when `mirror` is set (front camera, so the snap matches the preview).
 * Throws if the video has no frame yet or a 2D canvas is unavailable.
 */
export function captureSnap(video: HTMLVideoElement, filter: SnapFilter, { mirror = false } = {}): ImageData {
  return drawSnap(video, video.videoWidth, video.videoHeight, filter, mirror);
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
 * with the filter applied, ready for `takeSnap(image)`. Rejects if the file can't be decoded.
 */
export async function imageFileToSnap(file: Blob, filter: SnapFilter): Promise<ImageData> {
  const { source, w, h, done } = await decodeImage(file);
  try {
    return drawSnap(source, w, h, filter, false);
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

/**
 * The live frame as a snap through `filter`, or undefined when there is no usable camera frame —
 * pass the result straight to `takeSnap`, which then falls back to a placeholder.
 */
export function grabSnap(cam: Pick<CameraState, 'videoRef' | 'ready' | 'mirrored'>, filter: SnapFilter): ImageData | undefined {
  const video = cam.videoRef.current;
  if (!cam.ready || !video) return undefined;
  try {
    return captureSnap(video, filter, { mirror: cam.mirrored });
  } catch {
    return undefined;
  }
}
