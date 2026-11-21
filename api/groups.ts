import type { Result } from './_accounts.js';
import { groupAction, myGroups } from './_groups.js';
import { json, RedisNotConfigured, redisStore } from './_redis.js';

// Node.js runtime (the default for api/*.ts).

async function answer(run: () => Promise<Result>): Promise<Response> {
  try {
    const r = await run();
    return json(r.body, r.status);
  } catch (e) {
    if (e instanceof RedisNotConfigured) {
      console.error(e.message);
      return json({ error: 'not-configured' }, 503);
    }
    console.error('groups failed', e);
    return json({ error: 'server' }, 500);
  }
}

/** GET /api/groups?name=&token= → { groups } · 401 wrong token. (The friends poll carries them too.) */
export function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  return answer(() => myGroups(redisStore(), { name: q.get('name'), token: q.get('token') }));
}

/**
 * POST /api/groups { action: 'create', name, token, members, title? } → the group ·
 * { action: 'leave', name, token, id } → { id, left } · { action: 'rename', name, token, id, title } →
 * the group · 400 bad input / too few or many people · 401 wrong token · 404 unknown user or group.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  return answer(() => groupAction(redisStore(), body));
}
