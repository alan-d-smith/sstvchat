// Received snap images, saved per message so a snap is never received twice. Raw RGBA in
// IndexedDB (no canvas encoding needed); only the newest KEEP images are kept. Every call is a
// no-op where IndexedDB is missing (tests, private modes that block it).

const DB_NAME = 'sstv';
const STORE = 'snaps';
const KEEP = 30;

interface Row { w: number; h: number; data: Uint8ClampedArray }

let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const result = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Ids sort by creation time, so the oldest images are the first keys. */
export function newImageId(): string {
  return `${Date.now().toString(36).padStart(9, '0')}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveSnapImage(id: string, img: ImageData): Promise<void> {
  try {
    const d = await db();
    if (!d) return;
    const tx = d.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const row: Row = { w: img.width, h: img.height, data: new Uint8ClampedArray(img.data) };
    store.put(row, id);
    const keys = (await result(store.getAllKeys())).map(String).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) store.delete(k);
    await done(tx);
  } catch (e) {
    console.warn('[snaps] could not save image', e);
  }
}

export async function loadSnapImages(): Promise<Map<string, ImageData>> {
  const out = new Map<string, ImageData>();
  try {
    const d = await db();
    if (!d) return out;
    const store = d.transaction(STORE, 'readonly').objectStore(STORE);
    const [keys, rows] = await Promise.all([result(store.getAllKeys()), result(store.getAll() as IDBRequest<Row[]>)]);
    keys.forEach((k, i) => {
      const r = rows[i];
      if (r?.data) out.set(String(k), new ImageData(new Uint8ClampedArray(r.data), r.w, r.h));
    });
  } catch (e) {
    console.warn('[snaps] could not load images', e);
  }
  return out;
}

export async function clearSnapImages(): Promise<void> {
  try {
    const d = await db();
    if (!d) return;
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await done(tx);
  } catch {
    /* nothing saved */
  }
}
