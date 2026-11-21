// Which microphone and camera to use. The choice is a deviceId kept in localStorage (null = the
// system default); the audio engine reads it on every mic start and useCamera on every open.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export type DeviceKind = 'mic' | 'camera';

export const DEVICE_KEYS: Record<DeviceKind, string> = { mic: 'sstv.micId', camera: 'sstv.cameraId' };

const listeners = new Set<() => void>();

/** The chosen device for `kind`, or null for the system default. */
export function loadDeviceId(kind: DeviceKind): string | null {
  try {
    return localStorage.getItem(DEVICE_KEYS[kind]) || null;
  } catch {
    return null;
  }
}

/** Chooses a device (null = default) and tells every useDeviceId. */
export function saveDeviceId(kind: DeviceKind, id: string | null): void {
  try {
    if (id) localStorage.setItem(DEVICE_KEYS[kind], id);
    else localStorage.removeItem(DEVICE_KEYS[kind]);
  } catch {
    /* storage blocked: the choice lasts until reload at best */
  }
  for (const fn of [...listeners]) fn();
}

export const loadMicId = () => loadDeviceId('mic');

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The chosen device for `kind`, re-rendering when it changes. */
export function useDeviceId(kind: DeviceKind): string | null {
  return useSyncExternalStore(subscribe, () => loadDeviceId(kind), () => null);
}

/* ---------- the devices this browser can see ---------- */

export interface DeviceOption {
  id: string;
  label: string;
}

export interface DeviceLists {
  mics: DeviceOption[];
  cameras: DeviceOption[];
  /** Some devices have no name (or no id) until the page is allowed to use the mic/camera. */
  locked: { mic: boolean; camera: boolean };
}

const EMPTY: DeviceLists = { mics: [], cameras: [], locked: { mic: false, camera: false } };

/** Chrome's aliases for the system's current devices: the "Default" choice already covers them. */
const ALIASES = new Set(['default', 'communications']);

function options(all: MediaDeviceInfo[], kind: MediaDeviceKind, fallback: string) {
  const own = all.filter((d) => d.kind === kind && !ALIASES.has(d.deviceId));
  const seen = new Set<string>();
  const list: DeviceOption[] = [];
  for (const d of own) {
    if (!d.deviceId || seen.has(d.deviceId)) continue;
    seen.add(d.deviceId);
    list.push({ id: d.deviceId, label: d.label || `${fallback} ${list.length + 1}` });
  }
  return { list, locked: own.some((d) => !d.label || !d.deviceId) };
}

/** Microphones and cameras, named "Microphone 1", "Camera 1"… while their labels are hidden. */
export async function listDevices(): Promise<DeviceLists> {
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!media?.enumerateDevices) return EMPTY;
  try {
    const all = await media.enumerateDevices();
    const mics = options(all, 'audioinput', 'Microphone');
    const cameras = options(all, 'videoinput', 'Camera');
    return { mics: mics.list, cameras: cameras.list, locked: { mic: mics.locked, camera: cameras.locked } };
  } catch {
    return EMPTY;
  }
}

/** Same as the radio asks for, so a second stream never turns the OS processing back on. */
const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

/**
 * Asks once for the mic and/or camera so their names show up, then lets go of them at once.
 * Call it from a click.
 */
export async function unlockLabels(want: { mic: boolean; camera: boolean }): Promise<void> {
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!media?.getUserMedia || (!want.mic && !want.camera)) return;
  const ask = async (c: MediaStreamConstraints) => {
    const s = await media.getUserMedia(c);
    s.getTracks().forEach((t) => t.stop());
  };
  const audio = want.mic ? RAW_AUDIO : false;
  try {
    await ask({ audio, video: want.camera });
  } catch {
    // One of them is missing or refused: try each on its own.
    if (want.mic && want.camera) {
      await Promise.allSettled([ask({ audio }), ask({ video: true })]);
    }
  }
}

/** The device lists, kept fresh on `devicechange`, plus `unlock()` for the "Allow access" button. */
export function useMediaDevices(): DeviceLists & { unlock(): Promise<void> } {
  const [lists, setLists] = useState<DeviceLists>(EMPTY);

  const refresh = useCallback(async () => {
    const next = await listDevices();
    setLists(next);
    return next;
  }, []);

  useEffect(() => {
    let live = true;
    const relist = () => {
      void listDevices().then((next) => {
        if (live) setLists(next);
      });
    };
    relist();
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    media?.addEventListener?.('devicechange', relist);
    return () => {
      live = false;
      media?.removeEventListener?.('devicechange', relist);
    };
  }, []);

  const unlock = useCallback(async () => {
    await unlockLabels(lists.locked);
    await refresh();
  }, [lists.locked, refresh]);

  return { ...lists, unlock };
}
