// Friend requests, shared by the Vercel function (Upstash Redis) and the Vite dev server (in memory).
//
// Redis sets per username:
//   req:<name>      who asked <name> to be friends (incoming, pending)
//   sent:<name>     who <name> asked (outgoing, pending)
//   friends:<name>  accepted friends (kept symmetric)

import { NAME_RE, asRecord, credentials, fail, isSeed, normalName as normal, owns } from './_accounts.js';
import type { AccountStore, Result } from './_accounts.js';
import { groupsFor } from './_groups.js';
import type { Group } from './_groups.js';

export interface FriendEntry { name: string; avatar: number | null }
export interface FriendLists { incoming: FriendEntry[]; outgoing: FriendEntry[]; friends: FriendEntry[] }
export type FriendAction = 'request' | 'accept' | 'decline' | 'remove';
/** Where the pair stands after a POST, from the caller's side. */
export type FriendState = 'none' | 'requested' | 'friends';

const ACTIONS: readonly FriendAction[] = ['request', 'accept', 'decline', 'remove'];

/** GET /api/friends answers the friend lists and, so one poll covers both, the caller's group chats. */
export interface FriendsPoll extends FriendLists { groups: Group[] }

/**
 * GET /api/friends?name=&token= → { incoming, outgoing, friends, groups }: the first three
 * [{ name, avatar }] sorted by name, `groups` the caller's group chats (see _groups.ts). 401 unless
 * `token` is the one stored in `user:<name>`. Two store round trips: the user record and the four
 * sets together, then the avatars and the group records.
 */
export async function friendLists(store: AccountStore, input: Record<string, unknown>): Promise<Result> {
  const who = credentials(input);
  if ('status' in who) return who;
  const { name, token } = who;
  const [record, incoming, outgoing, friends, groupIds] = await Promise.all([
    store.get(`user:${name}`),
    store.smembers(`req:${name}`),
    store.smembers(`sent:${name}`),
    store.smembers(`friends:${name}`),
    store.smembers(`groups:${name}`),
  ]);
  if (!owns(record, token)) return fail(401, 'unauthorized');

  const all = [...new Set([...incoming, ...outgoing, ...friends])];
  const [seeds, groups] = await Promise.all([
    all.length ? store.mget(all.map((n) => `avatar:${n}`)) : Promise.resolve([]),
    groupsFor(store, name, groupIds),
  ]);
  const avatars = new Map(all.map((n, i) => {
    const seed = Number(seeds[i]);
    return [n, seeds[i] != null && isSeed(seed) ? seed : null] as const;
  }));
  const entries = (names: string[]): FriendEntry[] =>
    [...names].sort().map((n) => ({ name: n, avatar: avatars.get(n) ?? null }));
  const body: FriendsPoll = { incoming: entries(incoming), outgoing: entries(outgoing), friends: entries(friends), groups };
  return { status: 200, body };
}

/**
 * POST /api/friends { action, name, token, other } → { state }.
 * - request: 404 if `other` has no account, 400 for yourself. If `other` already asked you, this
 *   accepts instead; if you are already friends nothing changes.
 * - accept: 404 unless `other` has a pending request to you.
 * - decline: drops `other`'s request to you (no-op when there is none).
 * - remove: unfriends `other` and withdraws your own pending request to them.
 * 400 bad action/other · 401 token does not hold `name`.
 */
export async function friendAction(store: AccountStore, input: unknown): Promise<Result> {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const action = body.action as FriendAction;
  if (!ACTIONS.includes(action)) return fail(400, 'invalid-action');
  const who = credentials(body);
  if ('status' in who) return who;
  const { name, token } = who;
  const other = normal(body.other);
  if (!NAME_RE.test(other)) return fail(400, 'invalid-name');

  const [record, otherRecord, incoming, friends] = await Promise.all([
    store.get(`user:${name}`),
    store.get(`user:${other}`),
    store.smembers(`req:${name}`),
    store.smembers(`friends:${name}`),
  ]);
  if (!owns(record, token)) return fail(401, 'unauthorized');
  if (other === name) return fail(400, 'self');

  const ok = (state: FriendState): Result => ({ status: 200, body: { state } });
  const befriend = async () => {
    await Promise.all([
      store.srem(`req:${name}`, other),
      store.srem(`sent:${other}`, name),
      // A crossed request from our side is settled too.
      store.srem(`req:${other}`, name),
      store.srem(`sent:${name}`, other),
      store.sadd(`friends:${name}`, other),
      store.sadd(`friends:${other}`, name),
    ]);
    return ok('friends');
  };

  switch (action) {
    case 'request':
      if (!asRecord(otherRecord)) return fail(404, 'no-such-user');
      if (friends.includes(other)) return ok('friends');
      if (incoming.includes(other)) return befriend();
      await Promise.all([store.sadd(`req:${other}`, name), store.sadd(`sent:${name}`, other)]);
      return ok('requested');
    case 'accept':
      if (friends.includes(other)) return ok('friends');
      if (!incoming.includes(other)) return fail(404, 'no-request');
      return befriend();
    case 'decline':
      await Promise.all([store.srem(`req:${name}`, other), store.srem(`sent:${other}`, name)]);
      return ok(friends.includes(other) ? 'friends' : 'none');
    case 'remove':
      await Promise.all([
        store.srem(`friends:${name}`, other),
        store.srem(`friends:${other}`, name),
        store.srem(`sent:${name}`, other),
        store.srem(`req:${other}`, name),
      ]);
      return ok('none');
  }
}
