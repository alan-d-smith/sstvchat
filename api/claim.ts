import { claim } from './_accounts.js';
import { scryptPasswords } from './_password.js';
import { json, RedisNotConfigured, redisStore } from './_redis.js';

// Node.js runtime (the default for api/*.ts): scrypt and timingSafeEqual come from node:crypto.

/**
 * POST /api/claim { mode?: 'signup' | 'login', name, token, password?, avatar? }
 * signup → 200 claimed / ours · 409 taken. login → 200 { name, avatar } · 404 no such user ·
 * 409 no password set · 401 wrong password · 429 too many password guesses. Both: 400 bad input.
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
