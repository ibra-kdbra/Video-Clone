import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
        if (req.url.startsWith('/__mock/thumb/')) {
          const url = new URL(req.url, 'http://localhost');
          const id = decodeURIComponent(url.pathname.split('/').pop().replace(/\.svg$/, ''));
          res.setHeader('Content-Type', 'image/svg+xml');
          res.end(upstream.mockThumbnail(id, Number(url.searchParams.get('w')) || 480));
          return;
        }
        const { handle } = await load('/server/api/router.mjs');
        const request = new Request(new URL(req.url, 'http://localhost'), { method: req.method });
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
          api: 'modern-compiler',
          additionalData: (content, filePath) => {
            if (filePath.endsWith('_variables.scss') || filePath.endsWith('_mixins.scss')) return content;
            return `
              @use "sass:color";
              @use "@/styles/abstracts/variables" as *;
              @use "@/styles/abstracts/mixins" as *;
              ${content}
            `;
          },
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
    build: {
      outDir: 'dist',
    },
  };
});
