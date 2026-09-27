import { ApiError, fail, json } from './http.mjs';
import { twitch } from './twitch.mjs';
import { youtube } from './youtube.mjs';

/** Every endpoint the app may call. Anything else is a 404: the function is not an open proxy. */
const routes = {
  'youtube/search': youtube.search,
  'youtube/video': youtube.video,
  'youtube/related': youtube.related,
  'youtube/channel': youtube.channel,
  'youtube/channel-videos': youtube.channelVideos,
  'youtube/comments': youtube.comments,
  'twitch/search': twitch.search,
  'twitch/clip': twitch.clip,
  'twitch/trending': twitch.trending,
};

/**
 * Handles `/api/<provider>/<endpoint>?…`. `env` holds the server-side keys; `fetchImpl` is
 * swappable for tests and local development.
 */
export async function handle(request, env, fetchImpl = fetch) {
  if (request.method !== 'GET') return fail(405, 'method_not_allowed', 'Only GET requests are supported.');
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  const endpoint = Object.hasOwn(routes, route) ? routes[route] : null;
  if (!endpoint) return fail(404, 'not_found', 'Unknown API endpoint.');

  try {
    const { body, ttl } = await endpoint(url.searchParams, { env, fetch: fetchImpl });
    return json(body, ttl);
  } catch (error) {
    if (error instanceof ApiError) return fail(error.status, error.code, error.message);
    console.error(`[api] ${route} crashed: ${error?.message}`);
    return fail(500, 'server_error', 'Something went wrong on our side.');
  }
}
