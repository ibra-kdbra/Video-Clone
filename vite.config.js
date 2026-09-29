import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The security headers from netlify.toml's `for = "/*"` block, so `npm run preview` behaves like
 * the deployed site (including the Content-Security-Policy). The HTTPS-only parts are left out,
 * since the preview runs on plain http://localhost.
 */
function netlifyHeaders() {
  const toml = readFileSync(path.join(__dirname, 'netlify.toml'), 'utf8');
  const block = toml.split('[[headers]]').find((part) => /for = "\/\*"/.test(part)) ?? '';
  const headers = Object.fromEntries(
    [...block.matchAll(/^\s+([A-Z][A-Za-z-]+) = "(.*)"$/gm)].map(([, name, value]) => [name, value]),
  );
  delete headers['Strict-Transport-Security'];
  if (headers['Content-Security-Policy'])
    headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/, '');
  return headers;
}

/**
 * Serves `/api/*` in `vite` and `vite preview` with the same handler Netlify runs, so local
 * development needs no extra tooling. Keys come from `.env` (server-side names, no VITE_ prefix).
 * With `--mode mock` (or MOCK_API=1) it answers from a local stand-in of the video APIs instead,
 * so the app runs with no keys at all.
 */
function apiServer(env, mode) {
  const mock = mode === 'mock' || env.MOCK_API === '1';
  const attach = (server, load) =>
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/') && !(mock && req.url?.startsWith('/__mock/'))) return next();
      try {
        const upstream = mock ? await load('/tests/mocks/upstream.mjs') : null;
        if (req.url.startsWith('/__mock/')) {
          const url = new URL(req.url, 'http://localhost');
          const id = decodeURIComponent(url.pathname.split('/').pop().replace(/\.svg$/, ''));
          const label = url.searchParams.get('t') ?? '';
          res.setHeader('Content-Type', 'image/svg+xml');
          res.end(
            url.pathname.startsWith('/__mock/avatar/')
              ? upstream.mockAvatar(id, label)
              : upstream.mockThumbnail(id, Number(url.searchParams.get('w')) || 480, label),
          );
          return;
        }
        const { handle } = await load('/server/api/router.mjs');
        // Pass on where the request came from, so the cross-site check behaves as on Netlify.
        const headers = req.headers['sec-fetch-site'] ? { 'sec-fetch-site': req.headers['sec-fetch-site'] } : {};
        const request = new Request(new URL(req.url, 'http://localhost'), { method: req.method, headers });
        const keys = mock ? { YOUTUBE_API_KEY: 'mock', TWITCH_CLIENT_ID: 'mock', TWITCH_CLIENT_SECRET: 'mock' } : env;
        const response = await handle(request, keys, mock ? upstream.mockFetch : fetch);
        res.statusCode = response.status;
        response.headers.forEach((value, name) => res.setHeader(name, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        next(error);
      }
    });

  return {
    name: 'fundastream-api',
    configureServer(server) {
      attach(server, (file) => server.ssrLoadModule(file));
    },
    configurePreviewServer(server) {
      attach(server, (file) => import(/* @vite-ignore */ path.join(__dirname, file)));
    },
  };
}

export default defineConfig(({ mode }) => {
  // All variables from .env, not only VITE_ ones: the API keys stay on this (server) side.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), apiServer(env, mode)],
    css: {
      preprocessorOptions: {
        scss: {
          // Every stylesheet gets the breakpoint and helper mixins; colors, spacing and type are
          // CSS custom properties (src/styles/tokens.scss), so themes switch without a rebuild.
          additionalData: (content, filePath) =>
            filePath.endsWith('_mixins.scss') ? content : `@use "@/styles/mixins" as *;\n${content}`,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      open: true,
    },
    preview: {
      headers: netlifyHeaders(),
    },
    build: {
      outDir: 'dist',
    },
  };
});
