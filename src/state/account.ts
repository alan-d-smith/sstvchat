// Unique usernames: every name choice goes through POST /api/claim with this browser's token.
// The claimed name is the address used in packet `to`/`from`; it is kept in the `sstv_user`
// cookie, the token and avatar seed in localStorage.

import { NAME_RE } from '../../api/_accounts';

export { NAME_RE };

export interface Account { id: string; name: string; avatar: number }
export interface DirectoryUser { name: string; avatar: number | null }
export type ClaimResult = 'ok' | 'invalid' | 'taken' | 'wrong-password' | 'too-many' | 'not-configured' | 'server' | 'error';

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

const RESULTS: Record<number, ClaimResult> = {
  200: 'ok', 400: 'invalid', 401: 'wrong-password', 409: 'taken', 429: 'too-many',
  500: 'server', 503: 'not-configured',
};

export async function claimName(name: string, opts: { avatar: number; password?: string }): Promise<ClaimResult> {
  const n = normalizeName(name);
  if (!NAME_RE.test(n)) return 'invalid';
  try {
    const res = await fetch('/api/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: n, token: deviceToken(), avatar: opts.avatar, ...(opts.password ? { password: opts.password } : {}) }),
    });
    return RESULTS[res.status] ?? 'error';
  } catch {
    return 'error';
  }
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
