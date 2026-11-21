/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { claim, users } from './api/_accounts.js';
import type { AccountStore, Result } from './api/_accounts.js';

/** `vite` dev server only: /api/claim and /api/users from an in-memory map, same rules as api/*.ts. */
function devAccounts(): Plugin {
  const db = new Map<string, unknown>();
  const store: AccountStore = {
    setNx: async (key, value) => {
      if (db.has(key)) return false;
      db.set(key, value);
      return true;
    },
    get: async (key) => db.get(key) ?? null,
    set: async (key, value) => {
      db.set(key, value);
    },
    userKeys: async () => [...db.keys()].filter((k) => k.startsWith('user:')),
    mget: async (keys) => keys.map((k) => db.get(k) ?? null),
  };
  return {
    name: 'sstv-dev-accounts',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (incoming, res, next) => {
        // The app tsconfig has no Node types; this is all of IncomingMessage that is used.
        const req = incoming as unknown as { url?: string; method?: string } & AsyncIterable<string | Uint8Array>;
        const path = req.url?.split('?')[0];
        const send = ({ status, body }: Result) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (path === '/api/users' && req.method === 'GET') {
          send(await users(store));
        } else if (path === '/api/claim' && req.method === 'POST') {
          let raw = '';
          const decoder = new TextDecoder();
          for await (const chunk of req) raw += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            send({ status: 400, body: { error: 'invalid-json' } });
            return;
          }
          send(await claim(store, body));
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devAccounts()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
