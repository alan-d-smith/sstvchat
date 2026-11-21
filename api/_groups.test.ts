import { describe, expect, it } from 'vitest';
import { claim, memoryStore } from './_accounts.js';
import type { Passwords } from './_accounts.js';
import { friendLists } from './_friends.js';
import { GROUP_ID_RE, MAX_GROUP, asGroup, groupAction, myGroups, newGroupId } from './_groups.js';
import type { Group } from './_groups.js';

const plain: Passwords = { hash: async (pw) => pw, verify: async (pw, s) => pw === s };
const tok = (name: string) => `token-of-${name}`;

async function setup(...claimed: string[]) {
  const store = memoryStore(() => 0);
  for (const name of claimed) await claim(store, plain, { name, token: tok(name) });
  let n = 0;
  const ids = () => `g_test${String(++n).padStart(6, '0')}`;
  const act = (name: string, body: Record<string, unknown>, token = tok(name)) =>
    groupAction(store, { name, token, ...body }, { newId: ids, now: () => 1000 + n });
  const create = (name: string, members: string[], title?: string) => act(name, { action: 'create', members, title });
  const mine = async (name: string) => {
    const r = await myGroups(store, { name, token: tok(name) });
    expect(r.status).toBe(200);
    return (r.body as { groups: Group[] }).groups;
  };
  return { store, act, create, mine };
}

describe('POST /api/groups create', () => {
  it('stores the group with the creator first and lists it for every member', async () => {
    const { store, create, mine } = await setup('alan', 'bea', 'cy');
    const r = await create('alan', ['Bea', 'cy', 'bea', 'alan'], '  Roomies  ');
    expect(r).toEqual({
      status: 200,
      body: { id: 'g_test000001', title: 'Roomies', members: ['alan', 'bea', 'cy'], createdBy: 'alan', createdAt: 1001 },
    });
    expect(asGroup(await store.get('group:g_test000001'))).toEqual(r.body);
    for (const who of ['alan', 'bea', 'cy']) {
      expect(await store.smembers(`groups:${who}`)).toEqual(['g_test000001']);
      expect(await mine(who)).toEqual([r.body]);
    }
  });

  it('needs the creator plus at least two others, and at most 16 people', async () => {
    const names = Array.from({ length: MAX_GROUP + 1 }, (_, i) => `u${i}`);
    const { create } = await setup(...names);
    expect(await create('u0', ['u1'])).toEqual({ status: 400, body: { error: 'too-few' } });
    expect(await create('u0', ['u1', 'u1', 'u0'])).toEqual({ status: 400, body: { error: 'too-few' } });
    expect(await create('u0', names.slice(1))).toEqual({ status: 400, body: { error: 'too-many' } });
    expect((await create('u0', names.slice(1, MAX_GROUP))).status).toBe(200);
  });

  it('404s unclaimed members, naming them, and 400s bad input', async () => {
    const { create, act, mine } = await setup('alan', 'bea');
    expect(await create('alan', ['bea', 'ghost', 'nobody'])).toEqual({
      status: 404, body: { error: 'no-such-user', names: ['ghost', 'nobody'] },
    });
    expect(await mine('bea')).toEqual([]);
    expect((await create('alan', ['bea', 'no way'])).status).toBe(400);
    expect((await act('alan', { action: 'create', members: 'bea' })).status).toBe(400);
    expect((await create('alan', ['bea', 'cy'], 'x'.repeat(41))).body).toEqual({ error: 'invalid-title' });
    expect((await act('alan', { action: 'poke' })).body).toEqual({ error: 'invalid-action' });
    expect((await groupAction(memoryStore(), null)).status).toBe(400);
  });

  it('401s a token that does not hold the name', async () => {
    const { act, mine } = await setup('alan', 'bea', 'cy');
    expect(await act('alan', { action: 'create', members: ['bea', 'cy'] }, tok('bea'))).toEqual({
      status: 401, body: { error: 'unauthorized' },
    });
    expect((await act('ghost', { action: 'create', members: ['bea', 'cy'] })).status).toBe(401);
    expect(await mine('bea')).toEqual([]);
  });

  it('draws another id when one is taken', async () => {
    const { store, create } = await setup('alan', 'bea', 'cy');
    await store.set('group:g_test000001', { taken: true });
    expect((await create('alan', ['bea', 'cy'])).body).toMatchObject({ id: 'g_test000002' });
  });
});

describe('POST /api/groups leave / rename', () => {
  it('leave: drops the member, and deletes the group with its last member', async () => {
    const { store, create, act, mine } = await setup('alan', 'bea', 'cy');
    const { id } = (await create('alan', ['bea', 'cy'])).body as Group;
    expect(await act('bea', { action: 'leave', id })).toEqual({ status: 200, body: { id, left: true } });
    expect(await mine('bea')).toEqual([]);
    expect((await mine('alan'))[0].members).toEqual(['alan', 'cy']);
    expect((await mine('cy'))[0].members).toEqual(['alan', 'cy']);
    // Leaving again (or a group you are not in) is a 404.
    expect(await act('bea', { action: 'leave', id })).toEqual({ status: 404, body: { error: 'no-such-group' } });

    await act('alan', { action: 'leave', id });
    await act('cy', { action: 'leave', id });
    expect(await store.get(`group:${id}`)).toBeNull();
    expect(await mine('cy')).toEqual([]);
  });

  it('rename: members only; an empty title clears it', async () => {
    const { create, act, mine } = await setup('alan', 'bea', 'cy', 'dee');
    const { id } = (await create('alan', ['bea', 'cy'])).body as Group;
    expect(await act('bea', { action: 'rename', id, title: ' Beach  trip ' })).toMatchObject({ status: 200, body: { id, title: 'Beach trip' } });
    expect((await mine('cy'))[0].title).toBe('Beach trip');
    expect(await act('dee', { action: 'rename', id, title: 'mine now' })).toEqual({ status: 404, body: { error: 'no-such-group' } });
    expect((await act('alan', { action: 'rename', id, title: '' })).body).toMatchObject({ title: '' });
    expect((await act('alan', { action: 'rename', id: 'nope', title: 'x' })).body).toEqual({ error: 'invalid-id' });
  });
});

describe('GET /api/groups', () => {
  it('401s without the right token', async () => {
    const { store } = await setup('alan');
    expect(await myGroups(store, { name: 'alan', token: 'nope' })).toEqual({ status: 401, body: { error: 'unauthorized' } });
  });

  it('lists the caller’s groups oldest first and forgets ids whose group is gone', async () => {
    const { store, create, mine } = await setup('alan', 'bea', 'cy');
    const a = (await create('alan', ['bea', 'cy'], 'A')).body as Group;
    const b = (await create('bea', ['alan', 'cy'], 'B')).body as Group;
    expect((await mine('cy')).map((g) => g.title)).toEqual(['A', 'B']);
    await store.del(`group:${a.id}`);
    expect((await mine('cy')).map((g) => g.id)).toEqual([b.id]);
    expect(await store.smembers('groups:cy')).toEqual([b.id]);
  });

  it('rides along in the friends poll', async () => {
    const { store, create } = await setup('alan', 'bea', 'cy');
    expect((await friendLists(store, { name: 'bea', token: tok('bea') })).body).toMatchObject({ groups: [] });
    const g = (await create('alan', ['bea', 'cy'])).body as Group;
    expect((await friendLists(store, { name: 'bea', token: tok('bea') })).body).toMatchObject({ groups: [g] });
  });
});

describe('group records', () => {
  it('makes ids like g_ + 10 [a-z0-9]', () => {
    for (let i = 0; i < 20; i++) expect(newGroupId()).toMatch(GROUP_ID_RE);
    expect(new Set(Array.from({ length: 50 }, newGroupId)).size).toBe(50);
  });

  it('reads JSON strings and digit-only names back', () => {
    const g = { id: 'g_abcdefghij', title: 't', members: ['alan', 42], createdBy: 'alan', createdAt: 5 };
    expect(asGroup(JSON.stringify(g))).toEqual({ ...g, members: ['alan', '42'] });
    expect(asGroup({ ...g, id: 'roomies' })).toBeNull();
    expect(asGroup('not json')).toBeNull();
  });
});
