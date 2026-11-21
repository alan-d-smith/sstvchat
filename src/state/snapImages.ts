// Received snap images, saved per message in localStorage so a snap is never received twice and
// survives reloads. Each image is a JPEG data URL under `sstv.snap.<id>`; `sstv.snaps` lists the
// ids oldest first. Only the newest KEEP images are kept, and the oldest are evicted early if the
// browser's storage quota runs out. Every call is a no-op where localStorage or canvas is missing
// (tests, private modes that block storage).

const INDEX_KEY = 'sstv.snaps';
const PREFIX = 'sstv.snap.';
const KEEP = 40;
const QUALITY = 0.85;

function readIndex(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
  } catch {
    /* storage blocked */
  }
}

function drop(id: string) {
  try {
    localStorage.removeItem(PREFIX + id);
  } catch {
    /* storage blocked */
  }
}

function toDataUrl(img: ImageData): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/jpeg', QUALITY);
  } catch {
    return null;
  }
}

function fromDataUrl(url: string): Promise<ImageData | null> {
  return new Promise((resolve) => {
    try {
      const el = new Image();
      el.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = el.naturalWidth;
          canvas.height = el.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(el, 0, 0);
          resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
        } catch {
          resolve(null);
        }
      };
      el.onerror = () => resolve(null);
      el.src = url;
    } catch {
      resolve(null);
    }
  });
}

/** Ids sort by creation time, so the oldest images are the first keys. */
export function newImageId(): string {
  return `${Date.now().toString(36).padStart(9, '0')}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveSnapImage(id: string, img: ImageData): Promise<void> {
  const url = toDataUrl(img);
  if (!url) return;
  let ids = readIndex().filter((x) => x !== id);
  while (ids.length >= KEEP) drop(ids.shift()!);
  for (;;) {
    try {
      localStorage.setItem(PREFIX + id, url);
      ids.push(id);
      writeIndex(ids);
      return;
    } catch (e) {
      // Quota exceeded: evict the oldest saved image and retry; give up when nothing is left.
      if (ids.length === 0) {
        console.warn('[snaps] could not save image', e);
        return;
      }
      drop(ids.shift()!);
      writeIndex(ids);
    }
  }
}

export async function loadSnapImages(): Promise<Map<string, ImageData>> {
  const out = new Map<string, ImageData>();
  const ids = readIndex();
  const loaded = await Promise.all(
    ids.map(async (id) => {
      let url: string | null = null;
      try {
        url = localStorage.getItem(PREFIX + id);
      } catch {
        /* storage blocked */
      }
      return [id, url ? await fromDataUrl(url) : null] as const;
    }),
  );
  for (const [id, img] of loaded) if (img) out.set(id, img);
  return out;
}

/** Forgets one saved image (its message was deleted on this device). */
export function deleteSnapImage(id: string): void {
  drop(id);
  const ids = readIndex();
  if (ids.includes(id)) writeIndex(ids.filter((x) => x !== id));
}

export async function clearSnapImages(): Promise<void> {
  for (const id of readIndex()) drop(id);
  writeIndex([]);
}
