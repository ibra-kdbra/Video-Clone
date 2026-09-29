import { ApiError, fail, json } from './http.mjs';
import { dailymotion } from './dailymotion.mjs';
import { twitch } from './twitch.mjs';
import { youtube } from './youtube.mjs';

/**
 * Every endpoint the app may call, with the query parameters each one accepts. Anything else is
 * a 404 (the function is not an open proxy), and unknown or repeated parameters are a 400.
 */
const routes = {
  'youtube/search': { run: youtube.search, params: ['q'] },
  'youtube/trending': { run: youtube.trending, params: [] },
  'youtube/video': { run: youtube.video, params: ['id'] },
  'youtube/related': { run: youtube.related, params: ['id'] },
  'youtube/channel': { run: youtube.channel, params: ['id'] },
  'youtube/channel-videos': { run: youtube.channelVideos, params: ['id', 'pageToken'] },
  'youtube/comments': { run: youtube.comments, params: ['id'] },
  'dailymotion/search': { run: dailymotion.search, params: ['q'] },
  'dailymotion/trending': { run: dailymotion.trending, params: [] },
  'dailymotion/video': { run: dailymotion.video, params: ['id'] },
  'dailymotion/related': { run: dailymotion.related, params: ['id'] },
  'twitch/search': { run: twitch.search, params: ['q'] },
  'twitch/trending': { run: twitch.trending, params: [] },
  'twitch/clip': { run: twitch.clip, params: ['id'] },
  'twitch/related': { run: twitch.related, params: ['id'] },
};

/**
 * Browsers say where a request comes from (Sec-Fetch-Site). Another website's pages can't read
 * our responses, but they could still make visitors' browsers send requests that spend the free
 * API quotas, so cross-site requests are refused before any upstream call.
 */
const isCrossSite = (request) => request.headers.get('sec-fetch-site') === 'cross-site';

/**
 * Handles `/api/<provider>/<endpoint>?…`. `env` holds the server-side keys; `fetchImpl` is
 * swappable for tests and local development, and `timeout` (ms) for tests.
 */
export async function handle(request, env, fetchImpl = fetch, { timeout } = {}) {
  if (request.method !== 'GET') return fail(405, 'method_not_allowed', 'Only GET requests are supported.');
  if (isCrossSite(request)) return fail(403, 'forbidden', 'This API only serves FundaStream itself.');

  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  const spec = Object.hasOwn(routes, route) ? routes[route] : null;
  if (!spec) return fail(404, 'not_found', 'Unknown API endpoint.');

  const names = [...url.searchParams.keys()];
  const unknown = names.find((name) => !spec.params.includes(name));
  if (unknown !== undefined) return fail(400, 'bad_request', `Unknown parameter "${unknown.slice(0, 40)}".`);
  if (new Set(names).size !== names.length) return fail(400, 'bad_request', 'Each parameter may only be given once.');

  try {
    const { body, ttl } = await spec.run(url.searchParams, { env, fetch: fetchImpl, timeout });
    return json(body, ttl, spec.params);
  } catch (error) {
    if (error instanceof ApiError) return fail(error.status, error.code, error.message);
    console.error(`[api] ${route} crashed: ${error?.message}`);
    return fail(500, 'server_error', 'Something went wrong on our side.');
  }
}
