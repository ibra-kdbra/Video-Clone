/**
 * Writes Netlify's dist/_headers and dist/_redirects after `vite build`, from the build's
 * environment variables:
 *
 * - API_ORIGIN (e.g. https://grand-lms.duckdns.org): `/api/v1/*` is proxied there, so the browser
 *   talks to the Grand LMS API on its own origin and the sign-in cookie stays first-party.
 * - REALTIME_ORIGIN (defaults to API_ORIGIN): the WebSocket server the page may connect to. Netlify
 *   doesn't proxy WebSockets, so the browser connects to it directly.
 *
 * - MEDIA_ORIGIN (e.g. https://media.grand-lms.duckdns.org): the video store that lesson videos,
 *   posters and thumbnails stream from, through signed URLs.
 *
 * Without API_ORIGIN the site still builds; only the video pages work then.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { securityHeaders } from '../config/headers.mjs';

const dist = path.resolve(import.meta.dirname, '../dist');
const apiOrigin = process.env.API_ORIGIN?.replace(/\/$/, '') || null;
const realtimeOrigin = process.env.REALTIME_ORIGIN?.replace(/\/$/, '') || apiOrigin;
const mediaOrigin = process.env.MEDIA_ORIGIN?.replace(/\/$/, '') || null;

if (apiOrigin && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(apiOrigin)) {
  throw new Error(`API_ORIGIN must be an https origin such as https://grand-lms.duckdns.org, got "${apiOrigin}"`);
}

const headerBlock = (pattern, headers) =>
  [pattern, ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`)].join('\n');

writeFileSync(
  path.join(dist, '_headers'),
  [
    headerBlock('/*', securityHeaders({ realtimeOrigin, mediaOrigin })),
    // Vite fingerprints everything in /assets, so those files never change under the same name.
    headerBlock('/assets/*', { 'Cache-Control': 'public, max-age=31536000, immutable' }),
    '',
  ].join('\n'),
);

const spaFallback = readFileSync(path.join(dist, '_redirects'), 'utf8').trim();
const apiRule = apiOrigin
  ? `/api/v1/*  ${apiOrigin}/api/v1/:splat  200!`
  : // Answer API calls with a 404 instead of the app's index.html while no API is configured.
    '/api/v1/*  /404.json  404!';
writeFileSync(path.join(dist, '_redirects'), `${apiRule}\n${spaFallback}\n`);
if (!apiOrigin) writeFileSync(path.join(dist, '404.json'), '{"error":{"code":"not_found","message":"The API is not configured."}}\n');

console.log(
  `Netlify files written (API: ${apiOrigin ?? 'not configured'}, real-time: ${realtimeOrigin ?? 'same origin'}, media: ${mediaOrigin ?? 'not configured'}).`,
);
