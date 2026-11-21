/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { claim, memoryStore, users } from './api/_accounts.js';
import type { Result } from './api/_accounts.js';
import { scryptPasswords } from './api/_password.js';

/** `vite` dev server only: /api/claim and /api/users from memory, with the same rules as api/*.ts. */
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
        if (path === '/api/users' && req.method === 'GET') {
          send(await users(store));
        } else if (path === '/api/claim' && req.method === 'POST') {
          let raw = '';
          for await (const chunk of req) raw += String(chunk);
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            send({ status: 400, body: { error: 'invalid-json' } });
            return;
          }
          send(await claim(store, scryptPasswords, body));
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
