import { ApiError, PATTERNS, count, need, query, upstream } from './http.mjs';
import { video } from './video.mjs';

const BASE = 'https://api.dailymotion.com';

/** Dailymotion's public data API: read-only, free, and needs no key. */
const FIELDS = [
  'id',
  'title',
  'description',
  'thumbnail_360_url',
  'thumbnail_480_url',
  'thumbnail_720_url',
  'owner.id',
  'owner.screenname',
  'owner.avatar_80_url',
  'created_time',
  'views_total',
  'duration',
  'onair',
].join(',');

async function call(ctx, path, params = {}) {
  const url = new URL(BASE + path);
  for (const [name, value] of Object.entries({ fields: FIELDS, ...params })) url.searchParams.set(name, String(value));
  const response = await upstream(ctx, url, {}, `Dailymotion ${path.split('/')[1]}`);
  if (response.ok) return response.json();
  if (response.status === 404) throw new ApiError(404, 'not_found', 'That video was not found.');
  if (response.status === 429) throw new ApiError(429, 'quota', 'Dailymotion is limiting requests right now. Please try again shortly.');
  console.error(`[api] Dailymotion ${path.split('/')[1]} failed: ${response.status}`);
  throw new ApiError(502, 'upstream_error', 'Dailymotion did not respond as expected.');
}

/** Dailymotion names thumbnails by height; these are their 16:9 widths. */
function toVideo(item) {
  return video({
    provider: 'dailymotion',
    id: item.id,
    title: item.title,
    description: item.description,
    thumbnail: item.thumbnail_720_url ?? item.thumbnail_480_url,
    thumbnails: [
      { url: item.thumbnail_360_url, width: 640 },
      { url: item.thumbnail_480_url, width: 853 },
      { url: item.thumbnail_720_url, width: 1280 },
    ],
    channel: { id: item['owner.id'], title: item['owner.screenname'], avatar: item['owner.avatar_80_url'] },
    publishedAt: Number.isFinite(item.created_time) ? new Date(item.created_time * 1000).toISOString() : null,
    views: count(item.views_total),
    duration: item.duration,
    live: item.onair === true,
  });
}

const list = (data) => (data?.list ?? []).filter((item) => typeof item?.id === 'string').map(toVideo);

export const dailymotion = {
  async search(params, ctx) {
    const data = await call(ctx, '/videos', { search: query(params), limit: 24, sort: 'relevance', family_filter: 'true' });
    return { body: { items: list(data) }, ttl: 6 * 3600 };
  },

  async trending(_params, ctx) {
    const data = await call(ctx, '/videos', { sort: 'trending', limit: 24, family_filter: 'true' });
    return { body: { items: list(data) }, ttl: 3600 };
  },

  async video(params, ctx) {
    const id = need(params, 'id', PATTERNS.dailymotionId);
    return { body: { item: toVideo(await call(ctx, `/video/${id}`)) }, ttl: 3600 };
  },

  /** "Up next": the same creator's latest videos. */
  async related(params, ctx) {
    const id = need(params, 'id', PATTERNS.dailymotionId);
    const owner = (await call(ctx, `/video/${id}`, { fields: 'owner.id' }))['owner.id'];
    if (typeof owner !== 'string' || !/^[A-Za-z0-9]{1,30}$/.test(owner)) return { body: { items: [] }, ttl: 3600 };
    const data = await call(ctx, '/videos', { owners: owner, sort: 'recent', limit: 17, family_filter: 'true' });
    return { body: { items: list(data).filter((item) => item.id !== id).slice(0, 16) }, ttl: 3600 };
  },
};
