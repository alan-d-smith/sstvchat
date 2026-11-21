// Group chats, shared by the Vercel function (Upstash Redis) and the Vite dev server (in memory).
// Only membership lives on the server; the messages themselves still travel over the air.
//
//   group:<id>      { id, title, members, createdBy, createdAt } (JSON)
//   groups:<name>   ids of the groups <name> is in (set)

import { NAME_RE, asRecord, credentials, fail, normalName, owns } from './_accounts.js';
import type { AccountStore, Result } from './_accounts.js';

export interface Group {
  id: string;
  /** Chosen name; '' shows the members' names instead. */
  title: string;
  /** Usernames, the creator first. */
  members: string[];
  createdBy: string;
  /** Epoch ms. */
  createdAt: number;
}
export type GroupAction = 'create' | 'leave' | 'rename';

/** People in a new group, the creator included. */
export const MIN_GROUP = 3;
export const MAX_GROUP = 16;
export const MAX_TITLE = 40;
export const GROUP_ID_RE = /^g_[a-z0-9]{10}$/;

const ACTIONS: readonly GroupAction[] = ['create', 'leave', 'rename'];
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** `g_` and 10 random [a-z0-9] (Web Crypto: Node 19+ and browsers). */
export function newGroupId(): string {
  const bytes = new Uint8Array(10);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
  return `g_${Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('')}`;
}

/** A stored group record (Upstash hands back parsed JSON; a raw string is parsed too), or null. */
export function asGroup(v: unknown): Group | null {
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const { id, title, members, createdBy, createdAt } = v as Record<string, unknown>;
  if (typeof id !== 'string' || !GROUP_ID_RE.test(id) || !Array.isArray(members)) return null;
  return {
    id,
    title: typeof title === 'string' ? title : '',
    // Names made only of digits can come back from Redis as numbers.
    members: members.map(String).filter((m) => NAME_RE.test(m)),
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}

/** A title from a request: trimmed, '' when absent; null when it is not a string or too long. */
function titleOf(v: unknown): string | null {
  if (v == null) return '';
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t.length <= MAX_TITLE ? t : null;
}

/**
 * The groups `name` is in, from its `groups:<name>` ids (one MGET), oldest first. Ids whose group
 * is gone, or no longer lists `name`, are dropped from the set.
 */
export async function groupsFor(store: AccountStore, name: string, ids: string[]): Promise<Group[]> {
  if (!ids.length) return [];
  const records = await store.mget(ids.map((id) => `group:${id}`));
  const groups: Group[] = [];
  const stale: string[] = [];
  ids.forEach((id, i) => {
    const g = asGroup(records[i]);
    if (g && g.id === id && g.members.includes(name)) groups.push(g);
    else stale.push(id);
  });
  if (stale.length) await Promise.all(stale.map((id) => store.srem(`groups:${name}`, id)));
  return groups.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** GET /api/groups?name=&token= → { groups } · 401 unless `token` holds `name`. */
export async function myGroups(store: AccountStore, input: Record<string, unknown>): Promise<Result> {
  const who = credentials(input);
  if ('status' in who) return who;
  const { name, token } = who;
  const [record, ids] = await Promise.all([store.get(`user:${name}`), store.smembers(`groups:${name}`)]);
  if (!owns(record, token)) return fail(401, 'unauthorized');
  return { status: 200, body: { groups: await groupsFor(store, name, ids) } };
}

export interface GroupOptions { newId?: () => string; now?: () => number }

/**
 * POST /api/groups { action, name, token, ... }:
 * - create { members, title? } → the new group. Members are deduped and the caller is added
 *   first; 3–16 people in all (400 too-few / too-many), each a claimed name (404 no-such-user,
 *   with `names`).
 * - leave { id } → { id, left: true }. The group is deleted once its last member leaves.
 * - rename { id, title } → the group ('' clears the title). Members only.
 * 400 bad action/input · 401 token does not hold `name` · 404 no such group (or not a member).
 */
export async function groupAction(store: AccountStore, input: unknown, opts: GroupOptions = {}): Promise<Result> {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const action = body.action as GroupAction;
  if (!ACTIONS.includes(action)) return fail(400, 'invalid-action');
  const who = credentials(body);
  if ('status' in who) return who;
  const { name, token } = who;

  if (action === 'create') {
    if (!Array.isArray(body.members)) return fail(400, 'invalid-members');
    const names = body.members.map(normalName);
    if (names.some((n) => !NAME_RE.test(n))) return fail(400, 'invalid-name');
    const others = [...new Set(names)].filter((n) => n !== name);
    const title = titleOf(body.title);
    if (title === null) return fail(400, 'invalid-title');

    const [record, found] = await Promise.all([
      store.get(`user:${name}`),
      others.length ? store.mget(others.map((n) => `user:${n}`)) : Promise.resolve([] as unknown[]),
    ]);
    if (!owns(record, token)) return fail(401, 'unauthorized');
    if (others.length + 1 < MIN_GROUP) return fail(400, 'too-few');
    if (others.length + 1 > MAX_GROUP) return fail(400, 'too-many');
    const unknown = others.filter((_, i) => !asRecord(found[i]));
    if (unknown.length) return { status: 404, body: { error: 'no-such-user', names: unknown } };

    const members = [name, ...others];
    const newId = opts.newId ?? newGroupId;
    for (let tries = 0; tries < 3; tries++) {
      const group: Group = { id: newId(), title, members, createdBy: name, createdAt: (opts.now ?? Date.now)() };
      if (!(await store.setNx(`group:${group.id}`, group))) continue; // id clash: draw again
      await Promise.all(members.map((m) => store.sadd(`groups:${m}`, group.id)));
      return { status: 200, body: group };
    }
    return fail(500, 'id-clash');
  }

  const id = typeof body.id === 'string' ? body.id : '';
  if (!GROUP_ID_RE.test(id)) return fail(400, 'invalid-id');
  const title = action === 'rename' ? titleOf(body.title) : '';
  if (title === null) return fail(400, 'invalid-title');
  const [record, stored] = await Promise.all([store.get(`user:${name}`), store.get(`group:${id}`)]);
  if (!owns(record, token)) return fail(401, 'unauthorized');
  const group = asGroup(stored);
  if (!group || !group.members.includes(name)) {
    if (action === 'leave') await store.srem(`groups:${name}`, id); // tidy a stale id anyway
    return fail(404, 'no-such-group');
  }

  if (action === 'rename') {
    const next: Group = { ...group, title };
    await store.set(`group:${id}`, next);
    return { status: 200, body: next };
  }

  const members = group.members.filter((m) => m !== name);
  await Promise.all([
    store.srem(`groups:${name}`, id),
    members.length ? store.set(`group:${id}`, { ...group, members }) : store.del(`group:${id}`),
  ]);
  return { status: 200, body: { id, left: true } };
}
