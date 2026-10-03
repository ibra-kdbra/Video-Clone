import { ApiError, PATTERNS, need, upstream } from './http.mjs';
import { video } from './video.mjs';

const BASE = 'https://api.dailymotion.com';

/** Dailymotion's public data API: read-only, free, and needs no key. */
const FIELDS = ['id', 'title', 'thumbnail_360_url', 'thumbnail_480_url', 'thumbnail_720_url', 'duration'].join(',');

async function call(ctx, path) {
  const url = new URL(BASE + path);
  url.searchParams.set('fields', FIELDS);
  const response = await upstream(ctx, url, {}, 'Dailymotion video');
  if (response.ok) return response.json();
  if (response.status === 404) throw new ApiError(404, 'not_found', 'That video was not found.');
  if (response.status === 429) throw new ApiError(429, 'quota', 'Dailymotion is limiting requests right now. Please try again shortly.');
  console.error(`[api] Dailymotion video failed: ${response.status}`);
  throw new ApiError(502, 'upstream_error', 'Dailymotion did not respond as expected.');
}

export const dailymotion = {
  /** One video's title, pictures and length. Dailymotion names thumbnails by height; these are their 16:9 widths. */
  async video(params, ctx) {
    const id = need(params, 'id', PATTERNS.dailymotionId);
    const item = await call(ctx, `/video/${id}`);
    return {
      body: {
        item: video({
          provider: 'dailymotion',
          id: item.id,
          title: item.title,
          thumbnail: item.thumbnail_720_url ?? item.thumbnail_480_url,
          thumbnails: [
            { url: item.thumbnail_360_url, width: 640 },
            { url: item.thumbnail_480_url, width: 853 },
            { url: item.thumbnail_720_url, width: 1280 },
          ],
          duration: item.duration,
        }),
      },
      ttl: 3600,
    };
  },
};
