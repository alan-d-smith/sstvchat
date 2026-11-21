// Username rules shared by the Vercel functions (Upstash Redis) and the Vite dev server (in memory).
// Files starting with "_" in api/ are not deployed as functions.

export const NAME_RE = /^[a-z0-9_]{2,12}$/;

/** The few Redis operations the account endpoints need. */
export interface AccountStore {
  /** SET key value NX: true when the key was free and is now set. */
  setNx(key: string, value: string): Promise<boolean>;
  get(key: string): Promise<unknown>;
  set(key: string, value: number): Promise<void>;
  /** Every key matching `user:*` (SCAN). */
  userKeys(): Promise<string[]>;
  /** MGET. */
  mget(keys: string[]): Promise<unknown[]>;
}

export interface Result { status: number; body: unknown }

const isSeed = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 2 ** 31;

/**
 * POST /api/claim { name, token, avatar? }. 200 when the name is free (now claimed by `token`) or
 * already claimed by the same token; 409 when someone else holds it; 400 for a bad name or token.
 * On 200 an integer `avatar` seed is stored as `avatar:<name>`.
 */
export async function claim(store: AccountStore, input: unknown): Promise<Result> {
  const { name, token, avatar } = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const n = typeof name === 'string' ? name.trim().toLowerCase() : '';
  if (!NAME_RE.test(n)) return { status: 400, body: { error: 'invalid-name' } };
  if (typeof token !== 'string' || token.length < 8 || token.length > 128) {
    return { status: 400, body: { error: 'invalid-token' } };
  }
  const key = `user:${n}`;
  const mine = (await store.setNx(key, token)) || (await store.get(key)) === token;
  if (!mine) return { status: 409, body: { error: 'taken' } };
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
