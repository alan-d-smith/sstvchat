import type { Result } from './_accounts.js';
import { friendAction, friendLists } from './_friends.js';
import { json, RedisNotConfigured, redisStore } from './_redis.js';

async function answer(run: () => Promise<Result>): Promise<Response> {
  try {
    const r = await run();
    return json(r.body, r.status);
  } catch (e) {
    if (e instanceof RedisNotConfigured) {
      console.error(e.message);
      return json({ error: 'not-configured' }, 503);
    }
    console.error('friends failed', e);
    return json({ error: 'server' }, 500);
  }
}

/** GET /api/friends?name=&token= → { incoming, outgoing, friends } · 401 wrong token. */
export function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  return answer(() => friendLists(redisStore(), { name: q.get('name'), token: q.get('token') }));
}

/**
 * POST /api/friends { action: 'request'|'accept'|'decline'|'remove', name, token, other } →
 * { state } · 400 bad input · 401 wrong token · 404 no such user / no pending request.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  return answer(() => friendAction(redisStore(), body));
}
