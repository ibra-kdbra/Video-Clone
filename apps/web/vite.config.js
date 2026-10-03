import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { securityHeaders } from './config/headers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// One .env for the whole repository (web, API and worker); see .env.example there.
const repoRoot = path.resolve(__dirname, '../..');

/**
 * Serves the video proxy's `/api/*` (the details of the videos lessons embed) in `vite` and
 * `vite preview` with the same handler Netlify runs, so local development needs no extra tooling.
 * `/api/v1/*` is left to the Grand LMS API proxy below. Keys come from `.env` (server-side names, no
 * VITE_ prefix); without them, linked videos still play, with less detail.
 */
function videoProxy(env) {
  const attach = (server, load) =>
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/') || req.url.startsWith('/api/v1/')) return next();
      try {
        const { handle } = await load('/server/api/router.mjs');
        // Pass on where the request came from, so the cross-site check behaves as on Netlify.
        const headers = req.headers['sec-fetch-site'] ? { 'sec-fetch-site': req.headers['sec-fetch-site'] } : {};
        const response = await handle(new Request(new URL(req.url, 'http://localhost'), { method: req.method, headers }), env);
        res.statusCode = response.status;
        response.headers.forEach((value, name) => res.setHeader(name, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        next(error);
      }
    });

  return {
    name: 'grand-video-proxy',
    configureServer(server) {
      attach(server, (file) => server.ssrLoadModule(file));
    },
    configurePreviewServer(server) {
      attach(server, (file) => import(/* @vite-ignore */ path.join(__dirname, file)));
    },
  };
}

/**
 * Without the demo (VITE_DEMO isn't 'true'), src/demo isn't part of the build at all: its imports,
 * every one of them dynamic and behind `if (DEMO)`, resolve to an empty module that's never
 * written out, so not even an unused chunk of the demo ends up in dist/. Nor do the demo school's
 * videos (public/demo), copied in with the rest of public/.
 */
function demoOff(enabled) {
  const demoDir = path.join(__dirname, 'src', 'demo') + path.sep;
  const EMPTY = '\0grand-demo-off';
  let outDir;
  return {
    name: 'grand-demo-off',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!enabled) rmSync(path.join(outDir, 'demo'), { recursive: true, force: true });
    },
    async resolveId(source, importer, options) {
      if (enabled || !importer || importer.startsWith(demoDir)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved?.id.startsWith(demoDir) ? EMPTY : null;
    },
    load: (id) => (id === EMPTY ? 'export {};' : null),
    generateBundle(_, bundle) {
      // The empty stand-in's chunk, which nothing imports once the dead branches are gone.
      for (const [name, chunk] of Object.entries(bundle)) if (chunk.type === 'chunk' && chunk.facadeModuleId === EMPTY && !chunk.code.trim()) delete bundle[name];
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
  // Demo mode (VITE_DEMO=true): the LMS runs against a mock API in the page (src/lib/demo.js).
  // Always defined, as 'true' or 'false', so the build can drop the demo code when it's off.
  const demo = env.VITE_DEMO === 'true';

  return {
    envDir: repoRoot,
    plugins: [demoOff(demo), react(), videoProxy(env)],
    define: {
      'import.meta.env.VITE_REALTIME_ORIGIN': JSON.stringify(realtimeOrigin),
      'import.meta.env.VITE_DEMO': JSON.stringify(demo ? 'true' : 'false'),
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
      headers: securityHeaders({ realtimeOrigin, mediaOrigin: env.MEDIA_ORIGIN || undefined, livekitOrigin: env.LIVEKIT_ORIGIN || undefined, https: false }),
      proxy: apiProxy,
    },
    build: {
      outDir: 'dist',
    },
  };
});
