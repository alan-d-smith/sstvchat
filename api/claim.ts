import { claim } from './_accounts.js';
import { json, redisStore } from './_redis.js';

/** POST /api/claim { name, token, avatar? } → 200 claimed (or already ours) · 400 bad name · 409 taken. */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid-json' }, 400);
  }
  try {
    const r = await claim(redisStore(), body);
    return json(r.body, r.status);
  } catch (e) {
    console.error('claim failed', e);
    return json({ error: 'server' }, 500);
  }
}
