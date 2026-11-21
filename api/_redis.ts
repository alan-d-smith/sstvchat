import { Redis } from '@upstash/redis';
import type { AccountStore } from './_accounts.js';

/** Thrown when no Upstash REST URL/token pair is present in the function's environment. */
export class RedisNotConfigured extends Error {
  constructor() {
    super('Upstash Redis env vars missing: set UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN');
  }
}

/**
 * Redis.fromEnv() reads UPSTASH_REDIS_REST_* or KV_REST_API_*. The Vercel Marketplace integration
 * can add a custom prefix (e.g. STORAGE_KV_REST_API_URL), so fall back to matching by suffix.
 */
function connectRedis(): Redis {
  const env = process.env;
  if ((env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) || (env.KV_REST_API_URL && env.KV_REST_API_TOKEN)) {
    return Redis.fromEnv();
  }
  const find = (suffix: string) => Object.keys(env).find((k) => k.endsWith(suffix) && env[k]);
  for (const [u, t] of [['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], ['KV_REST_API_URL', 'KV_REST_API_TOKEN']]) {
    const urlKey = find(u);
    const tokenKey = urlKey ? Object.keys(env).find((k) => k === urlKey.slice(0, -u.length) + t && env[k]) : undefined;
    if (urlKey && tokenKey) return new Redis({ url: env[urlKey]!, token: env[tokenKey]! });
  }
  throw new RedisNotConfigured();
}

/** AccountStore over the Upstash Redis connected to this Vercel project (UPSTASH_REDIS_REST_* env). */
export function redisStore(): AccountStore {
  const redis = connectRedis();
  return {
    setNx: async (key, value) => (await redis.set(key, value, { nx: true })) === 'OK',
    get: (key) => redis.get(key),
    set: async (key, value) => {
      await redis.set(key, value);
    },
    incr: (key) => redis.incr(key),
    expire: async (key, seconds) => {
      await redis.expire(key, seconds);
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
