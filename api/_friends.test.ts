import { describe, expect, it } from 'vitest';
import { claim, memoryStore } from './_accounts.js';
import type { AccountStore, Passwords } from './_accounts.js';
import { friendAction, friendLists } from './_friends.js';

const plain: Passwords = { hash: async (pw) => pw, verify: async (pw, s) => pw === s };
const tok = (name: string) => `token-of-${name}`;

async function setup(...claimed: string[]) {
  const store = memoryStore(() => 0);
  for (const [i, name] of claimed.entries()) await claim(store, plain, { name, token: tok(name), avatar: i + 1 });
  const act = (name: string, action: string, other: string, token = tok(name)) =>
    friendAction(store, { action, name, token, other });
  const lists = async (name: string) => {
    const r = await friendLists(store, { name, token: tok(name) });
    expect(r.status).toBe(200);
    return r.body as { incoming: { name: string }[]; outgoing: { name: string }[]; friends: { name: string }[] };
  };
  const names = async (name: string) => {
    const l = await lists(name);
    return { incoming: l.incoming.map((e) => e.name), outgoing: l.outgoing.map((e) => e.name), friends: l.friends.map((e) => e.name) };
  };
  return { store, act, lists, names };
}

describe('memoryStore sets', () => {
  it('adds, removes and lists members like SADD/SREM/SMEMBERS', async () => {
    const store: AccountStore = memoryStore();
    expect(await store.smembers('s')).toEqual([]);
    await store.sadd('s', 'a');
    await store.sadd('s', 'b');
    await store.sadd('s', 'a');
    expect((await store.smembers('s')).sort()).toEqual(['a', 'b']);
    await store.srem('s', 'a');
    await store.srem('s', 'zzz');
    expect(await store.smembers('s')).toEqual(['b']);
    await store.srem('s', 'b');
    expect(await store.get('s')).toBeNull();
  });
});

describe('GET /api/friends', () => {
  it('401s without the token that holds the name', async () => {
    const { store } = await setup('alan');
    expect(await friendLists(store, { name: 'alan', token: 'nope-nope' })).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect((await friendLists(store, { name: 'ghost', token: tok('ghost') })).status).toBe(401);
    expect((await friendLists(store, { name: 'alan', token: null })).status).toBe(401);
    expect((await friendLists(store, { name: null, token: tok('alan') })).status).toBe(401);
  });

  it('starts empty, then lists entries with avatars sorted by name', async () => {
    const { act, lists } = await setup('alan', 'bea', 'cy');
    expect(await lists('alan')).toEqual({ incoming: [], outgoing: [], friends: [], groups: [] });
    await act('cy', 'request', 'alan');
    await act('bea', 'request', 'alan');
    expect((await lists('alan')).incoming).toEqual([{ name: 'bea', avatar: 2 }, { name: 'cy', avatar: 3 }]);
    expect((await lists('bea')).outgoing).toEqual([{ name: 'alan', avatar: 1 }]);
  });
});

describe('POST /api/friends', () => {
  it('request: records the request on both sides', async () => {
    const { act, names } = await setup('alan', 'bea');
    expect(await act('alan', 'request', 'Bea')).toEqual({ status: 200, body: { state: 'requested' } });
    expect(await names('alan')).toEqual({ incoming: [], outgoing: ['bea'], friends: [] });
    expect(await names('bea')).toEqual({ incoming: ['alan'], outgoing: [], friends: [] });
    // Asking again changes nothing.
    expect((await act('alan', 'request', 'bea')).status).toBe(200);
    expect(await names('bea')).toEqual({ incoming: ['alan'], outgoing: [], friends: [] });
  });

  it('request: 404 for an unclaimed name, 400 for yourself or a bad name, 401 for a wrong token', async () => {
    const { act, names } = await setup('alan', 'bea');
    expect(await act('alan', 'request', 'ghost')).toEqual({ status: 404, body: { error: 'no-such-user' } });
    expect(await act('alan', 'request', 'alan')).toEqual({ status: 400, body: { error: 'self' } });
    expect((await act('alan', 'request', 'no way')).status).toBe(400);
    expect(await act('alan', 'request', 'bea', tok('bea'))).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect((await act('ghost', 'request', 'bea')).status).toBe(401);
    expect(await names('bea')).toEqual({ incoming: [], outgoing: [], friends: [] });
  });

  it('request back to someone who asked you accepts instead', async () => {
    const { act, names } = await setup('alan', 'bea');
    await act('alan', 'request', 'bea');
    expect(await act('bea', 'request', 'alan')).toEqual({ status: 200, body: { state: 'friends' } });
    expect(await names('alan')).toEqual({ incoming: [], outgoing: [], friends: ['bea'] });
    expect(await names('bea')).toEqual({ incoming: [], outgoing: [], friends: ['alan'] });
    // Already friends: another request is a no-op.
    expect(await act('alan', 'request', 'bea')).toEqual({ status: 200, body: { state: 'friends' } });
    expect(await names('bea')).toEqual({ incoming: [], outgoing: [], friends: ['alan'] });
  });

  it('accept: needs a pending request, then makes both friends', async () => {
    const { act, names } = await setup('alan', 'bea');
    expect(await act('bea', 'accept', 'alan')).toEqual({ status: 404, body: { error: 'no-request' } });
    await act('alan', 'request', 'bea');
    // Only the receiver can accept.
    expect((await act('alan', 'accept', 'bea')).status).toBe(404);
    expect(await act('bea', 'accept', 'alan')).toEqual({ status: 200, body: { state: 'friends' } });
    expect(await names('alan')).toEqual({ incoming: [], outgoing: [], friends: ['bea'] });
    expect(await names('bea')).toEqual({ incoming: [], outgoing: [], friends: ['alan'] });
  });

  it('decline: drops the request on both sides, and they can ask again', async () => {
    const { act, names } = await setup('alan', 'bea');
    await act('alan', 'request', 'bea');
    expect(await act('bea', 'decline', 'alan')).toEqual({ status: 200, body: { state: 'none' } });
    expect(await names('alan')).toEqual({ incoming: [], outgoing: [], friends: [] });
    expect(await names('bea')).toEqual({ incoming: [], outgoing: [], friends: [] });
    expect((await act('bea', 'decline', 'alan')).status).toBe(200);
    expect(await act('alan', 'request', 'bea')).toEqual({ status: 200, body: { state: 'requested' } });
  });

  it('remove: unfriends both ways and withdraws an outgoing request', async () => {
    const { act, names } = await setup('alan', 'bea', 'cy');
    await act('alan', 'request', 'bea');
    await act('bea', 'accept', 'alan');
    await act('alan', 'request', 'cy');
    expect(await act('alan', 'remove', 'bea')).toEqual({ status: 200, body: { state: 'none' } });
    expect(await act('alan', 'remove', 'cy')).toEqual({ status: 200, body: { state: 'none' } });
    expect(await names('alan')).toEqual({ incoming: [], outgoing: [], friends: [] });
    expect(await names('bea')).toEqual({ incoming: [], outgoing: [], friends: [] });
    expect(await names('cy')).toEqual({ incoming: [], outgoing: [], friends: [] });
  });

  it('400s an unknown action or a missing body', async () => {
    const { act, store } = await setup('alan', 'bea');
    expect(await act('alan', 'poke', 'bea')).toEqual({ status: 400, body: { error: 'invalid-action' } });
    expect((await friendAction(store, null)).status).toBe(400);
  });

  it('keeps names with digits only as strings', async () => {
    const { act, names } = await setup('alan', '42');
    await act('42', 'request', 'alan');
    expect(await names('alan')).toEqual({ incoming: ['42'], outgoing: [], friends: [] });
  });
});
