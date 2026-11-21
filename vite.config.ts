/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { claim, memoryStore, users } from './api/_accounts.js';
import type { Result } from './api/_accounts.js';
import { friendAction, friendLists } from './api/_friends.js';
import { groupAction, myGroups } from './api/_groups.js';
import { scryptPasswords } from './api/_password.js';

/** `vite` dev server only: /api/claim, /api/users, /api/friends and /api/groups from memory, with the same rules as api/*.ts. */
function devAccounts(): Plugin {
  const store = memoryStore();
  return {
    name: 'sstv-dev-accounts',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];
        const send = ({ status, body }: Result) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        const readJson = async (): Promise<{ ok: true; body: unknown } | { ok: false }> => {
          let raw = '';
          for await (const chunk of req) raw += String(chunk);
          try {
            return { ok: true, body: JSON.parse(raw) };
          } catch {
            send({ status: 400, body: { error: 'invalid-json' } });
            return { ok: false };
          }
        };
        if (path === '/api/users' && req.method === 'GET') {
          send(await users(store));
        } else if (path === '/api/claim' && req.method === 'POST') {
          const r = await readJson();
          if (r.ok) send(await claim(store, scryptPasswords, r.body));
        } else if (path === '/api/friends' && req.method === 'GET') {
          const q = new URLSearchParams(req.url?.split('?')[1] ?? '');
          send(await friendLists(store, { name: q.get('name'), token: q.get('token') }));
        } else if (path === '/api/friends' && req.method === 'POST') {
          const r = await readJson();
          if (r.ok) send(await friendAction(store, r.body));
        } else if (path === '/api/groups' && req.method === 'GET') {
          const q = new URLSearchParams(req.url?.split('?')[1] ?? '');
          send(await myGroups(store, { name: q.get('name'), token: q.get('token') }));
        } else if (path === '/api/groups' && req.method === 'POST') {
          const r = await readJson();
          if (r.ok) send(await groupAction(store, r.body));
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
