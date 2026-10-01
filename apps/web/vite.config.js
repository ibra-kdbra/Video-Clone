import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { securityHeaders } from './config/headers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// One .env for the whole repository (web, API and worker); see .env.example there.
const repoRoot = path.resolve(__dirname, '../..');

/**
 * Serves the video proxy's `/api/*` in `vite` and `vite preview` with the same handler Netlify runs,
 * so local development needs no extra tooling. `/api/v1/*` is left to the Grand LMS API proxy below. Keys come from `.env` (server-side names, no VITE_ prefix).
 * With `--mode mock` (or MOCK_API=1) it answers from a local stand-in of the video APIs instead,
 * so the app runs with no keys at all.
 */
function apiServer(env, mode) {
  const mock = mode === 'mock' || env.MOCK_API === '1';
  const attach = (server, load) =>
    server.middlewares.use(async (req, res, next) => {
      const videoApi = req.url?.startsWith('/api/') && !req.url.startsWith('/api/v1/');
      if (!videoApi && !(mock && req.url?.startsWith('/__mock/'))) return next();
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

export default defineConfig(({ command, mode }) => {
  // All variables from .env, not only VITE_ ones: the API keys stay on this (server) side.
  const env = loadEnv(mode, repoRoot, '');
  // Locally, the Grand LMS API (REST and WebSocket) is proxied under /api/v1, so the page talks to
  // its own origin. Built for production, the page connects to REALTIME_ORIGIN (or API_ORIGIN)
  // for WebSockets, since Netlify's proxy doesn't carry them.
  const apiProxy = {
    '/api/v1': { target: env.LOCAL_API_URL || 'http://localhost:3000', ws: true },
  };
  const realtimeOrigin = command === 'build' ? (env.REALTIME_ORIGIN || env.API_ORIGIN || '').replace(/\/$/, '') : '';

  return {
    envDir: repoRoot,
    plugins: [react(), apiServer(env, mode)],
    define: {
      'import.meta.env.VITE_REALTIME_ORIGIN': JSON.stringify(realtimeOrigin),
    },
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
        // The API's shared schemas, straight from their TypeScript source (no build step needed).
        '@grand/contracts': path.resolve(repoRoot, 'packages/contracts/src/index.ts'),
      },
    },
    server: {
      port: 5173,
      open: true,
      proxy: apiProxy,
    },
    preview: {
      // The production headers, minus the HTTPS-only parts, since the preview runs on plain http.
      headers: securityHeaders({ realtimeOrigin, https: false }),
      proxy: apiProxy,
    },
    build: {
      outDir: 'dist',
    },
  };
});
