// Unique usernames: every name choice goes through POST /api/claim with this browser's token
// (mode 'signup' for a new name, 'login' to move a name with a password onto this device).
// The claimed name is the address used in packet `to`/`from`; it is kept in the `sstv_user`
// cookie, the token and avatar seed in localStorage. Logging out forgets both and rotates the token.

import { NAME_RE } from '../../api/_accounts';

export { NAME_RE };

export interface Account { id: string; name: string; avatar: number }
export interface DirectoryUser { name: string; avatar: number | null }
export type ClaimResult =
  | 'ok' | 'invalid' | 'taken' | 'wrong-password' | 'too-many' | 'no-such-user' | 'no-password'
  | 'not-configured' | 'server' | 'error';

export const USER_COOKIE = 'sstv_user';
const TOKEN_KEY = 'sstv.token';
const AVATAR_KEY = 'sstv.avatar';
const ONE_YEAR_S = 31536000;

export const normalizeName = (name: string) => name.trim().toLowerCase();
export const isValidName = (name: string) => NAME_RE.test(normalizeName(name));

/** A stable default avatar for a name that has not picked one. */
export function seedFor(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

let memoryToken: string | null = null;

/** This browser's claim token: created once with crypto.randomUUID() and kept in localStorage. */
export function deviceToken(): string {
  try {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) return saved;
  } catch {
    /* storage blocked: fall back to a token for this page load */
  }
  memoryToken ??= crypto.randomUUID();
  try {
    localStorage.setItem(TOKEN_KEY, memoryToken);
  } catch {
    /* see above */
  }
  return memoryToken;
}

function readAvatar(): number | null {
  try {
    const v = Number(localStorage.getItem(AVATAR_KEY));
    return localStorage.getItem(AVATAR_KEY) !== null && Number.isInteger(v) ? v : null;
  } catch {
    return null;
  }
}

function writeAvatar(seed: number) {
  try {
    localStorage.setItem(AVATAR_KEY, String(seed));
  } catch {
    /* only the default avatar after a reload */
  }
}

function readCookie(): string | null {
  const prefix = `${USER_COOKIE}=`;
  const hit = document.cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(prefix));
  if (!hit) return null;
  try {
    return decodeURIComponent(hit.slice(prefix.length)) || null;
  } catch {
    return null;
  }
}

/** The name this browser already claimed, if any (skips the name screen on load). */
export function savedAccount(): Account | null {
  const name = readCookie();
  if (!name || !NAME_RE.test(name)) return null;
  return { id: name, name, avatar: readAvatar() ?? seedFor(name) };
}

/** Remembers a claimed name (cookie) and its avatar (localStorage). */
export function saveAccount(a: Account): void {
  document.cookie = `${USER_COOKIE}=${encodeURIComponent(a.name)}; path=/; max-age=${ONE_YEAR_S}; SameSite=Lax`;
  writeAvatar(a.avatar);
}

/** Forgets the session on this device: the name cookie, the avatar, and the token (a fresh one, so
 * the name needs its password to come back here). Chats stay: they belong to the device. */
export function forgetAccount(): void {
  document.cookie = `${USER_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  memoryToken = crypto.randomUUID();
  try {
    localStorage.removeItem(AVATAR_KEY);
    localStorage.setItem(TOKEN_KEY, memoryToken);
  } catch {
    /* storage blocked: the memory token is used for this page load */
  }
}

const RESULTS: Record<number, ClaimResult> = {
  200: 'ok', 400: 'invalid', 401: 'wrong-password', 404: 'no-such-user', 409: 'taken', 429: 'too-many',
  500: 'server', 503: 'not-configured',
};

async function postClaim(body: Record<string, unknown>): Promise<{ result: ClaimResult; body: unknown }> {
  try {
    const res = await fetch('/api/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, token: deviceToken() }),
    });
    const json: unknown = await res.json().catch(() => null);
    const error = json && typeof json === 'object' ? (json as { error?: unknown }).error : undefined;
    const result = res.status === 409 && error === 'no-password' ? 'no-password' : RESULTS[res.status] ?? 'error';
    return { result, body: json };
  } catch {
    return { result: 'error', body: null };
  }
}

/** Signs up a free name (or re-saves one this device holds, e.g. a new avatar). */
export async function claimName(name: string, opts: { avatar: number; password?: string }): Promise<ClaimResult> {
  const n = normalizeName(name);
  if (!NAME_RE.test(n)) return 'invalid';
  const { result } = await postClaim({
    mode: 'signup', name: n, avatar: opts.avatar, ...(opts.password ? { password: opts.password } : {}),
  });
  return result;
}

/** Logs this device into an existing name with its password; on 'ok', `avatar` is the stored one. */
export async function loginName(name: string, password: string): Promise<{ result: ClaimResult; avatar: number | null }> {
  const n = normalizeName(name);
  if (!NAME_RE.test(n)) return { result: 'invalid', avatar: null };
  const { result, body } = await postClaim({ mode: 'login', name: n, password });
  const avatar = body && typeof body === 'object' ? (body as { avatar?: unknown }).avatar : null;
  return { result, avatar: result === 'ok' && Number.isInteger(avatar) ? avatar as number : null };
}

/** Everyone who has claimed a name; empty when the server cannot be reached. */
export async function fetchUsers(): Promise<DirectoryUser[]> {
  try {
    const res = await fetch('/api/users', { headers: { accept: 'application/json' } });
    if (!res.ok) return [];
    const list: unknown = await res.json();
    if (!Array.isArray(list)) return [];
    return list.filter((u): u is DirectoryUser => !!u && typeof u.name === 'string' && NAME_RE.test(u.name));
  } catch {
    return [];
  }
}
