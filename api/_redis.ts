import { Redis } from '@upstash/redis';
import type { AccountStore } from './_accounts.js';

/** AccountStore over the Upstash Redis connected to this Vercel project (UPSTASH_REDIS_REST_* env). */
export function redisStore(): AccountStore {
  const redis = Redis.fromEnv();
  return {
    setNx: async (key, value) => (await redis.set(key, value, { nx: true })) === 'OK',
    get: (key) => redis.get(key),
    set: async (key, value) => {
      await redis.set(key, value);
    },
    userKeys: async () => {
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [next, batch] = await redis.scan(cursor, { match: 'user:*', count: 500 });
        keys.push(...batch);
        cursor = String(next);
      } while (cursor !== '0');
      return [...new Set(keys)];
    },
    mget: (keys) => redis.mget(...keys),
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
