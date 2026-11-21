// Username rules shared by the Vercel functions (Upstash Redis) and the Vite dev server (in memory).
// Files starting with "_" in api/ are not deployed as functions.

export const NAME_RE = /^[a-z0-9_]{2,12}$/;
/** Password guesses allowed per name per window. */
export const MAX_GUESSES = 5;
export const GUESS_WINDOW_S = 15 * 60;
const MAX_PASSWORD = 256;

/** The few Redis operations the account endpoints need. */
export interface AccountStore {
  /** SET key value NX: true when the key was free and is now set. */
  setNx(key: string, value: unknown): Promise<boolean>;
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  /** DEL key. */
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  /** Every key matching `user:*` (SCAN). */
  userKeys(): Promise<string[]>;
  /** MGET. */
  mget(keys: string[]): Promise<unknown[]>;
  /** SADD key member. */
  sadd(key: string, member: string): Promise<void>;
  /** SREM key member. */
  srem(key: string, member: string): Promise<void>;
  /** SMEMBERS key (empty when the set does not exist). */
  smembers(key: string): Promise<string[]>;
}

export interface Passwords {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

/** Value of `user:<name>`: the claiming device's token and an optional password hash. */
export interface UserRecord { token: string; pw: string | null }

export interface Result { status: number; body: unknown }

export const isSeed = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 2 ** 31;

export function asRecord(v: unknown): UserRecord | null {
  if (!v || typeof v !== 'object') return null;
  const { token, pw } = v as Record<string, unknown>;
  return typeof token === 'string' ? { token, pw: typeof pw === 'string' ? pw : null } : null;
}

/** A trimmed, lower-cased username (not yet validated). */
export const normalName = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
export const fail = (status: number, error: string): Result => ({ status, body: { error } });

/** Valid `name` + `token` pair from a request (not yet checked against the store), or the 401 to answer with. */
export function credentials(input: Record<string, unknown>): { name: string; token: string } | Result {
  const name = normalName(input.name);
  const { token } = input;
  if (!NAME_RE.test(name) || typeof token !== 'string' || !token) return fail(401, 'unauthorized');
  return { name, token };
}

/** The stored `user:<name>` record is held by `token`. */
export const owns = (record: unknown, token: string) => asRecord(record)?.token === token;

/**
 * POST /api/claim { name, token, password?, avatar? }
 * - 200: the name was free (claimed with SET NX), or this token already holds it, or the right
 *   password was given (the stored token is replaced, so this device now holds it).
 * - 400 bad name/token · 401 wrong password · 409 taken (no password given, or none set) ·
 *   429 more than MAX_GUESSES password guesses for the name in GUESS_WINDOW_S.
 * On 200 an integer `avatar` seed is stored as `avatar:<name>`.
 */
export async function claim(store: AccountStore, passwords: Passwords, input: unknown): Promise<Result> {
  const { name, token, password, avatar } = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const n = typeof name === 'string' ? name.trim().toLowerCase() : '';
  if (!NAME_RE.test(n)) return { status: 400, body: { error: 'invalid-name' } };
  if (typeof token !== 'string' || token.length < 8 || token.length > 128) {
    return { status: 400, body: { error: 'invalid-token' } };
  }
  if (password != null && (typeof password !== 'string' || password.length > MAX_PASSWORD)) {
    return { status: 400, body: { error: 'invalid-password' } };
  }
  const pw = password ? password : null;

  const key = `user:${n}`;
  const fresh: UserRecord = { token, pw: pw ? await passwords.hash(pw) : null };
  if (!(await store.setNx(key, fresh))) {
    const cur = asRecord(await store.get(key));
    if (cur?.token !== token) {
      if (!pw || !cur?.pw) return { status: 409, body: { error: 'taken' } };
      const failKey = `pwfail:${n}`;
      const guesses = await store.incr(failKey);
      if (guesses === 1) await store.expire(failKey, GUESS_WINDOW_S);
      if (guesses > MAX_GUESSES) return { status: 429, body: { error: 'too-many-tries' } };
      if (!(await passwords.verify(pw, cur.pw))) return { status: 401, body: { error: 'wrong-password' } };
      await store.set(key, { token, pw: cur.pw } satisfies UserRecord);
    }
  }
  if (isSeed(avatar)) await store.set(`avatar:${n}`, avatar);
  return { status: 200, body: { name: n } };
}

/** GET /api/users: every claimed name with its avatar seed (null when none was picked). */
export async function users(store: AccountStore): Promise<Result> {
  const names = (await store.userKeys()).map((k) => k.slice('user:'.length)).sort();
  const seeds = names.length ? await store.mget(names.map((n) => `avatar:${n}`)) : [];
  return {
    status: 200,
    body: names.map((name, i) => {
      const seed = Number(seeds[i]);
      return { name, avatar: seeds[i] != null && isSeed(seed) ? seed : null };
    }),
  };
}

/** In-memory AccountStore with Redis semantics (SET NX, INCR, EXPIRE, sets): `vite` dev server and tests. */
export function memoryStore(now: () => number = Date.now): AccountStore {
  const db = new Map<string, { value: unknown; expires: number }>();
  const live = (key: string) => {
    const e = db.get(key);
    if (e && e.expires <= now()) db.delete(key);
    return db.get(key);
  };
  return {
    setNx: async (key, value) => {
      if (live(key)) return false;
      db.set(key, { value, expires: Infinity });
      return true;
    },
    get: async (key) => live(key)?.value ?? null,
    set: async (key, value) => {
      db.set(key, { value, expires: Infinity });
    },
    del: async (key) => {
      db.delete(key);
    },
    incr: async (key) => {
      const e = live(key);
      const next = (Number(e?.value) || 0) + 1;
      db.set(key, { value: next, expires: e?.expires ?? Infinity });
      return next;
    },
    expire: async (key, seconds) => {
      const e = live(key);
      if (e) e.expires = now() + seconds * 1000;
    },
    userKeys: async () => [...db.keys()].filter((k) => k.startsWith('user:') && live(k)),
    mget: async (keys) => keys.map((k) => live(k)?.value ?? null),
    sadd: async (key, member) => {
      const e = live(key);
      if (e?.value instanceof Set) e.value.add(member);
      else db.set(key, { value: new Set([member]), expires: Infinity });
    },
    srem: async (key, member) => {
      const e = live(key);
      if (!(e?.value instanceof Set)) return;
      e.value.delete(member);
      if (e.value.size === 0) db.delete(key); // Redis drops empty sets
    },
    smembers: async (key) => {
      const v = live(key)?.value;
      return v instanceof Set ? [...v] as string[] : [];
    },
  };
}
