import { describe, expect, it } from 'vitest';
import { claim, users } from './_accounts.js';
import type { AccountStore } from './_accounts.js';

function memory(): AccountStore & { db: Map<string, unknown> } {
  const db = new Map<string, unknown>();
  return {
    db,
    setNx: async (k, v) => (db.has(k) ? false : (db.set(k, v), true)),
    get: async (k) => db.get(k) ?? null,
    set: async (k, v) => {
      db.set(k, v);
    },
    userKeys: async () => [...db.keys()].filter((k) => k.startsWith('user:')),
    mget: async (keys) => keys.map((k) => db.get(k) ?? null),
  };
}

const T1 = 'token-one-1234';
const T2 = 'token-two-5678';

describe('claim', () => {
  it('claims a free name (trimmed, lowercased) and stores the avatar seed', async () => {
    const s = memory();
    expect(await claim(s, { name: '  Alan_1 ', token: T1, avatar: 7 })).toEqual({ status: 200, body: { name: 'alan_1' } });
    expect(s.db.get('user:alan_1')).toBe(T1);
    expect(s.db.get('avatar:alan_1')).toBe(7);
  });

  it('lets the same token claim again (and change its avatar), refuses another token', async () => {
    const s = memory();
    await claim(s, { name: 'alan', token: T1, avatar: 1 });
    expect((await claim(s, { name: 'ALAN', token: T1, avatar: 2 })).status).toBe(200);
    expect(s.db.get('avatar:alan')).toBe(2);
    expect(await claim(s, { name: 'alan', token: T2, avatar: 3 })).toEqual({ status: 409, body: { error: 'taken' } });
    expect(s.db.get('avatar:alan')).toBe(2);
  });

  it('rejects names outside ^[a-z0-9_]{2,12}$ and missing tokens with 400', async () => {
    const s = memory();
    for (const name of ['a', 'thirteen_char', 'two words', 'émile', '', 42]) {
      expect((await claim(s, { name, token: T1 })).status).toBe(400);
    }
    expect((await claim(s, { name: 'ok' })).status).toBe(400);
    expect((await claim(s, null)).status).toBe(400);
    expect(s.db.size).toBe(0);
  });
});

describe('users', () => {
  it('lists every claimed name with its avatar (null when none)', async () => {
    const s = memory();
    await claim(s, { name: 'zed', token: T1 });
    await claim(s, { name: 'amy', token: T2, avatar: 5 });
    expect(await users(s)).toEqual({ status: 200, body: [{ name: 'amy', avatar: 5 }, { name: 'zed', avatar: null }] });
  });
});
