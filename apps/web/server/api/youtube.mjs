import { ApiError, PATTERNS, isoSeconds, need, upstream } from './http.mjs';
import { video } from './video.mjs';

const GOOGLE = 'https://www.googleapis.com/youtube/v3';

/**
 * The official YouTube Data API, free with a Google Cloud API key (no billing account). A video's
 * details cost 1 of the 10,000 units a day the free tier allows, and every response is cached (see
 * json() in http.mjs). The key only ever lives here.
 */
async function call(ctx, path, params) {
  const key = ctx.env.YOUTUBE_API_KEY;
  if (!key) throw new ApiError(503, 'not_configured', 'YouTube is not set up yet (missing API key on the server).');
  const url = new URL(GOOGLE + path);
  for (const [name, value] of Object.entries({ ...params, key }))
    if (value !== undefined && value !== '') url.searchParams.set(name, String(value));

  const response = await upstream(ctx, url, {}, `YouTube ${path}`);
  if (response.ok) return response.json();

  let reason = '';
  try {
    const body = await response.json();
    reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? body?.message ?? '';
  } catch {
    // Not JSON; the status is enough.
  }
  if (response.status === 429 || /quota|dailyLimit|rateLimit/i.test(reason))
    throw new ApiError(429, 'quota', "YouTube's free daily limit has been reached. It resets at midnight Pacific time.");
  if (response.status === 404 || /notFound/i.test(reason)) throw new ApiError(404, 'not_found', 'That video was not found.');
  console.error(`[api] YouTube ${path} failed: ${response.status} ${reason}`);
  throw new ApiError(502, 'upstream_error', 'YouTube did not respond as expected.');
}

const SIZES = ['medium', 'high', 'standard', 'maxres'];

export const youtube = {
  /** One video's title, pictures and length (1 unit). */
  async video(params, ctx) {
    const id = need(params, 'id', PATTERNS.videoId);
    const data = await call(ctx, '/videos', { part: 'snippet,contentDetails', id });
    const found = data.items?.[0];
    if (!found) throw new ApiError(404, 'not_found', 'That video was not found.');
    const thumbs = found.snippet?.thumbnails ?? {};
    const item = video({
      provider: 'youtube',
      id: found.id,
      title: found.snippet?.title,
      thumbnail: thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url,
      thumbnails: SIZES.map((size) => thumbs[size]).filter(Boolean),
      duration: isoSeconds(found.contentDetails?.duration),
    });
    return { body: { item }, ttl: 3600 };
  },
};
