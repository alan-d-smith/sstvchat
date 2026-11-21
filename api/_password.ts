import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Passwords } from './_accounts.js';

const SALT_BYTES = 16;
const KEY_LEN = 64;

function derive(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keylen, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Salted scrypt (node:crypto), stored as `scrypt$<saltB64>$<hashB64>`. Node.js runtime only. */
export const scryptPasswords: Passwords = {
  async hash(password) {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt, KEY_LEN);
    return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
  },
  async verify(password, stored) {
    const [alg, salt, hash] = stored.split('$');
    if (alg !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64');
    if (expected.length === 0) return false;
    const actual = await derive(password, Buffer.from(salt, 'base64'), expected.length);
    return timingSafeEqual(actual, expected);
  },
};
