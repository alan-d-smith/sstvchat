import { claim } from './_accounts.js';
import { scryptPasswords } from './_password.js';
import { json, RedisNotConfigured, redisStore } from './_redis.js';

// Node.js runtime (the default for api/*.ts): scrypt and timingSafeEqual come from node:crypto.

/**
 * POST /api/claim { name, token, password?, avatar? } → 200 claimed / ours / recovered with the
 * password · 400 bad input · 401 wrong password · 409 taken · 429 too many password guesses.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  try {
    const r = await claim(redisStore(), scryptPasswords, body);
    return json(r.body, r.status);
  } catch (e) {
    if (e instanceof RedisNotConfigured) {
      console.error(e.message);
      return json({ error: 'not-configured' }, 503);
    }
    console.error('claim failed', e);
    return json({ error: 'server' }, 500);
  }
}
