// Friend requests on the client: the /api/friends calls, how often to poll them, and what counts
// as news (a new request, or one of ours accepted). What was already seen and the notification
// list are kept per username in localStorage, so a reload or a second tab does not repeat them.

import type { FriendAction, FriendEntry, FriendLists, FriendState } from '../../api/_friends';
import { NAME_RE } from '../../api/_accounts';
import { parseGroups } from './groups';
import type { Group } from './groups';

export type { FriendAction, FriendEntry, FriendLists, FriendState } from '../../api/_friends';

export const NO_FRIENDS: FriendLists = { incoming: [], outgoing: [], friends: [] };

/** Poll every 3 s while the tab is visible, every 20 s while hidden; 15 s after repeated errors. */
export const POLL_VISIBLE_MS = 3_000;
export const POLL_HIDDEN_MS = 20_000;
export const POLL_BACKOFF_MS = 15_000;
/** Consecutive failed polls before backing off. */
export const BACKOFF_AFTER = 3;

export function pollDelay(hidden: boolean, errors: number): number {
  if (hidden) return POLL_HIDDEN_MS;
  return errors >= BACKOFF_AFTER ? POLL_BACKOFF_MS : POLL_VISIBLE_MS;
}

export class FriendsError extends Error {
  constructor(readonly status: number) {
    super(`friends request failed (${status})`);
  }
}

function entries(v: unknown): FriendEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e): e is FriendEntry => !!e && typeof e.name === 'string' && NAME_RE.test(e.name))
    .map((e) => ({ name: e.name, avatar: Number.isInteger(e.avatar) ? e.avatar : null }));
}

/** One poll: the friend lists, plus the user's group chats when the server sent them. */
export type FriendsPoll = FriendLists & { groups?: Group[] };

/** GET /api/friends. Throws FriendsError (status 0 when the server cannot be reached). */
export async function fetchFriends(name: string, token: string): Promise<FriendsPoll> {
  let res: Response;
  try {
    const q = new URLSearchParams({ name, token });
    res = await fetch(`/api/friends?${q}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
  } catch {
    throw new FriendsError(0);
  }
  if (!res.ok) throw new FriendsError(res.status);
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new FriendsError(500);
  return {
    incoming: entries(body.incoming), outgoing: entries(body.outgoing), friends: entries(body.friends),
    groups: parseGroups(body.groups),
  };
}

export type FriendResult = { ok: true; state: FriendState } | { ok: false; status: number };

/** POST /api/friends { action, name, token, other }. */
export async function postFriend(action: FriendAction, name: string, token: string, other: string): Promise<FriendResult> {
  try {
    const res = await fetch('/api/friends', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, name, token, other }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const body = (await res.json().catch(() => null)) as { state?: FriendState } | null;
    return { ok: true, state: body?.state ?? 'none' };
  } catch {
    return { ok: false, status: 0 };
  }
}

/* ---------- what is news ---------- */

/** Per user: incoming requests already announced, and our outgoing requests at the last poll. */
/** `friends` is absent in memories saved before removals were tracked: then nothing counts as removed. */
export interface FriendMemory { seen: string[]; outgoing: string[]; friends?: string[] }

export interface FriendNews {
  /** Incoming requests not announced before. */
  added: FriendEntry[];
  /** People we had asked who are now friends. */
  accepted: FriendEntry[];
  /** Friends at the last poll who are no longer friends (they removed us). */
  removed: FriendEntry[];
  /** Memory to keep for the next poll. */
  memory: FriendMemory;
}

/**
 * Compares a poll with what was remembered. A request that goes away (accepted or declined) is
 * forgotten, so the same person asking again later is announced again.
 */
export function friendNews(prev: FriendMemory | null, next: FriendLists): FriendNews {
  const seen = new Set(prev?.seen ?? []);
  const asked = new Set(prev?.outgoing ?? []);
  return {
    added: next.incoming.filter((e) => !seen.has(e.name)),
    accepted: next.friends.filter((e) => asked.has(e.name)),
    removed: (prev?.friends ?? [])
      .filter((name) => !next.friends.some((e) => e.name === name))
      .map((name) => ({ name, avatar: null })),
    memory: {
      seen: next.incoming.map((e) => e.name),
      outgoing: next.outgoing.map((e) => e.name),
      friends: next.friends.map((e) => e.name),
    },
  };
}

const memoryKey = (user: string) => `sstv.friends.${user}`;
const noticesKey = (user: string) => `sstv.notices.${user}`;

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked or full: news may repeat after a reload */
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

export function loadMemory(user: string): FriendMemory | null {
  const v = readJson(memoryKey(user)) as Partial<FriendMemory> | null;
  return v && typeof v === 'object' ? { seen: strings(v.seen), outgoing: strings(v.outgoing) } : null;
}

export function saveMemory(user: string, memory: FriendMemory): void {
  writeJson(memoryKey(user), memory);
}

/* ---------- notification list (the bell) ---------- */

export interface FriendNotice {
  id: string;
  kind: 'request' | 'accepted' | 'removed';
  name: string;
  avatar: number | null;
  /** Epoch ms. */
  at: number;
  read: boolean;
}

export const MAX_NOTICES = 30;

export const noticeText = (n: Pick<FriendNotice, 'kind' | 'name'>) =>
  n.kind === 'request' ? `${n.name} added you`
    : n.kind === 'removed' ? `${n.name} removed you as a friend`
    : `${n.name} accepted your request`;

/** "alan added you", "alan and bea added you", "alan and 2 others added you". */
export function addedText(names: string[]): string {
  if (names.length <= 1) return `${names[0] ?? 'Someone'} added you`;
  if (names.length === 2) return `${names[0]} and ${names[1]} added you`;
  return `${names[0]} and ${names.length - 1} others added you`;
}

export function loadNotices(user: string): FriendNotice[] {
  const v = readJson(noticesKey(user));
  if (!Array.isArray(v)) return [];
  return v.filter((n): n is FriendNotice =>
    !!n && typeof n.id === 'string' && (n.kind === 'request' || n.kind === 'accepted')
    && typeof n.name === 'string' && typeof n.at === 'number');
}

export function saveNotices(user: string, list: FriendNotice[]): void {
  writeJson(noticesKey(user), list.slice(0, MAX_NOTICES));
}

/** Newest first, capped at MAX_NOTICES. */
export function addNotices(list: FriendNotice[], kind: FriendNotice['kind'], who: FriendEntry[], at: number): FriendNotice[] {
  const fresh = who.map((e, i) => ({ id: `${kind}:${e.name}:${at}:${i}`, kind, name: e.name, avatar: e.avatar, at, read: false }));
  return [...fresh, ...list].slice(0, MAX_NOTICES);
}

/** Label for the add-friend buttons: "Add friends", plus the pending-request count. */
export const addFriendsLabel = (requests: number) =>
  requests ? `Add friends, ${requests} ${requests === 1 ? 'request' : 'requests'}` : 'Add friends';

/** The badge text: hidden (null) at 0, capped at 99+. */
export const badgeText = (n: number) => (n <= 0 ? null : n > 99 ? '99+' : String(n));

/** "now", "5m", "3h", "2d". */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/* ---------- system notifications ---------- */

export type NotifyPermission = NotificationPermission | 'unsupported';

export function notifyPermission(): NotifyPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Asks for notification permission; call it from a click. */
export async function askNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** A system notification, when allowed; clicking it focuses the tab and runs `onClick`. */
export function systemNotify(body: string, onClick?: () => void): void {
  if (notifyPermission() !== 'granted') return;
  try {
    const n = new Notification('SSTV Chat', { body, icon: '/favicon.svg' });
    n.onclick = () => {
      window.focus();
      n.close();
      onClick?.();
    };
  } catch {
    /* e.g. Android Chrome only allows notifications from a service worker */
  }
}
