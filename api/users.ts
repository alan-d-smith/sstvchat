import { users } from './_accounts.js';
import { json, RedisNotConfigured, redisStore } from './_redis.js';

/** GET /api/users → [{ name, avatar }] for every claimed username. */
export async function GET(): Promise<Response> {
  try {
    const r = await users(redisStore());
    return json(r.body, r.status);
  } catch (e) {
    if (e instanceof RedisNotConfigured) {
      console.error(e.message);
      return json({ error: 'not-configured' }, 503);
    }
    console.error('users failed', e);
    return json({ error: 'server' }, 500);
  }
}
