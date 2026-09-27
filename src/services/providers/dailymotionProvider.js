import { formatDuration } from '../../utils/format.js';
import { PROVIDERS } from './types.js';

// Dailymotion's public data API: read-only, no key or OAuth needed, so it's called directly.
const BASE_URL = 'https://api.dailymotion.com';

const get = async (path, params) => {
  const url = new URL(BASE_URL + path);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dailymotion responded with ${response.status}`);
  return response.json();
};

const FIELDS = 'id,title,thumbnail_720_url,thumbnail_480_url,owner.screenname,owner.id,created_time,views_total,duration,description';

/**
 * Normalize a Dailymotion API item into the common video shape.
 */
const normalize = (item) => {
  const id = item?.id ?? '';
  const duration = formatDuration(item?.duration);

  return {
    id,
    provider: PROVIDERS.DAILYMOTION,
    title: item?.title ?? '',
    thumbnail: item?.thumbnail_720_url ?? item?.thumbnail_480_url ?? '',
    channelTitle: item?.['owner.screenname'] ?? item?.owner?.screenname ?? '',
    channelId: item?.['owner.id'] ?? item?.owner?.id ?? '',
    publishedAt: item?.created_time
      ? new Date(item.created_time * 1000).toISOString()
      : '',
    viewCount: String(item?.views_total ?? ''),
    duration,
    description: item?.description ?? '',
    playerUrl: `https://www.dailymotion.com/video/${id}`,
    _raw: item,
  };
};

export const dailymotionProvider = {
  id: PROVIDERS.DAILYMOTION,

  /**
   * Search Dailymotion videos by query.
   */
  search: async (query) => {
    try {
      const data = await get('/videos', { search: query, fields: FIELDS, limit: 20, sort: 'relevance' });
      return (data?.list ?? []).map(normalize);
    } catch (err) {
      console.warn('[DailymotionProvider] search failed:', err.message);
      return [];
    }
  },

  /**
   * Get video details by id.
   */
  getDetails: async (videoId) => {
    try {
      const data = await get(`/video/${encodeURIComponent(videoId)}`, { fields: FIELDS });
      return data ? normalize(data) : null;
    } catch (err) {
      console.warn('[DailymotionProvider] getDetails failed:', err.message);
      return null;
    }
  },

  /**
   * Related / trending videos.
   */
  getRelated: async (videoId) => {
    try {
      const data = await get(`/video/${encodeURIComponent(videoId)}/related`, { fields: FIELDS, limit: 10 });
      return (data?.list ?? []).map(normalize);
    } catch (err) {
      console.warn('[DailymotionProvider] getRelated failed:', err.message);
      return [];
    }
  },
};
