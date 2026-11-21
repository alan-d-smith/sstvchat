import { describe, expect, it } from 'vitest';
import { GUESS_WINDOW_S, claim, memoryStore, users } from './_accounts.js';
import type { Passwords } from './_accounts.js';
import { scryptPasswords } from './_password.js';

/** Fast stand-in for scrypt so the flow tests stay quick; scrypt itself is tested at the end. */
const plain: Passwords = {
  hash: async (pw) => `plain$${pw}`,
  verify: async (pw, stored) => stored === `plain$${pw}`,
};

function setup() {
  let t = 0;
  const store = memoryStore(() => t);
  const post = (body: unknown) => claim(store, plain, body);
  return { store, post, wait: (s: number) => { t += s * 1000; } };
}

const A = 'device-a-token';
const B = 'device-b-token';

describe('claim', () => {
  it('claims a free name (trimmed, lowercased) as { token, pw } and stores the avatar seed', async () => {
    const { store, post } = setup();
    expect(await post({ name: '  Alan_1 ', token: A, avatar: 7 })).toEqual({ status: 200, body: { name: 'alan_1' } });
    expect(await store.get('user:alan_1')).toEqual({ token: A, pw: null });
    expect(await store.get('avatar:alan_1')).toBe(7);
    await post({ name: 'bea', token: A, password: 'hunter2' });
    expect(await store.get('user:bea')).toEqual({ token: A, pw: 'plain$hunter2' });
  });

  it('lets the same token claim again and change its avatar', async () => {
    const { store, post } = setup();
    await post({ name: 'alan', token: A, avatar: 1 });
    expect((await post({ name: 'ALAN', token: A, avatar: 2 })).status).toBe(200);
    expect(await store.get('avatar:alan')).toBe(2);
  });

  it('409s another device when no password is given or none is set', async () => {
    const { store, post } = setup();
    await post({ name: 'nopw', token: A });
    await post({ name: 'haspw', token: A, password: 'secret' });
    expect((await post({ name: 'nopw', token: B, password: 'anything', avatar: 3 })).status).toBe(409);
    expect((await post({ name: 'haspw', token: B })).status).toBe(409);
    expect((await post({ name: 'haspw', token: B, password: '' })).status).toBe(409);
    expect(await store.get('avatar:nopw')).toBeNull();
    expect(await store.get('pwfail:nopw')).toBeNull();
  });

  it('hands the name to a new device with the right password, 401s a wrong one', async () => {
    const { store, post } = setup();
    await post({ name: 'bea', token: A, password: 'secret' });
    expect(await post({ name: 'bea', token: B, password: 'nope' })).toEqual({ status: 401, body: { error: 'wrong-password' } });
    expect(await post({ name: 'bea', token: B, password: 'secret', avatar: 9 })).toEqual({ status: 200, body: { name: 'bea' } });
    expect(await store.get('user:bea')).toEqual({ token: B, pw: 'plain$secret' });
    expect(await store.get('avatar:bea')).toBe(9);
    // The old device no longer holds it.
    expect((await post({ name: 'bea', token: A })).status).toBe(409);
  });

  it('allows 5 password guesses per name per 15 minutes, then 429s', async () => {
    const { post, wait } = setup();
    await post({ name: 'bea', token: A, password: 'secret' });
    for (let i = 0; i < 5; i++) expect((await post({ name: 'bea', token: B, password: `x${i}` })).status).toBe(401);
    expect(await post({ name: 'bea', token: B, password: 'secret' })).toEqual({ status: 429, body: { error: 'too-many-tries' } });
    wait(GUESS_WINDOW_S - 1);
    expect((await post({ name: 'bea', token: B, password: 'secret' })).status).toBe(429);
    wait(1);
    expect((await post({ name: 'bea', token: B, password: 'secret' })).status).toBe(200);
  });

  it('400s names outside ^[a-z0-9_]{2,12}$, bad tokens and non-string passwords', async () => {
    const { store, post } = setup();
    for (const name of ['a', 'thirteen_char', 'two words', 'émile', '', 42]) {
      expect((await post({ name, token: A })).status).toBe(400);
    }
    expect((await post({ name: 'ok' })).status).toBe(400);
    expect((await post({ name: 'ok', token: A, password: 5 })).status).toBe(400);
    expect((await post(null)).status).toBe(400);
    expect(await store.userKeys()).toEqual([]);
  });
});

describe('users', () => {
  it('lists every claimed name with its avatar (null when none), never tokens', async () => {
    const { post, store } = setup();
    await post({ name: 'zed', token: A, password: 'pw' });
    await post({ name: 'amy', token: B, avatar: 5 });
    const r = await users(store);
    expect(r).toEqual({ status: 200, body: [{ name: 'amy', avatar: 5 }, { name: 'zed', avatar: null }] });
    expect(JSON.stringify(r.body)).not.toContain(A);
  });
});

describe('scrypt passwords', () => {
  it('stores a salted scrypt$salt$hash and verifies only the same password', async () => {
    const stored = await scryptPasswords.hash('correct horse');
    const [alg, salt, hash] = stored.split('$');
    expect(alg).toBe('scrypt');
    expect(Buffer.from(salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(hash, 'base64')).toHaveLength(64);
    expect(await scryptPasswords.hash('correct horse')).not.toBe(stored);
    expect(await scryptPasswords.verify('correct horse', stored)).toBe(true);
    expect(await scryptPasswords.verify('wrong horse', stored)).toBe(false);
    expect(await scryptPasswords.verify('correct horse', 'garbage')).toBe(false);
  });
});
