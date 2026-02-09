import axios from 'axios';
import { PROVIDERS } from './types.js';

// Dailymotion's public data API (no OAuth required for read-only access)
const BASE_URL = 'https://api.dailymotion.com';

const api = axios.create({
  baseURL: BASE_URL,
});

const FIELDS = 'id,title,thumbnail_720_url,thumbnail_480_url,owner.screenname,owner.id,created_time,views_total,duration,description';

/**
 * Normalize a Dailymotion API item into the common video shape.
 */
const normalize = (item) => {
  const id = item?.id ?? '';
  const duration = item?.duration
    ? `${Math.floor(item.duration / 60)}:${String(item.duration % 60).padStart(2, '0')}`
    : '';

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
      const { data } = await api.get('/videos', {
        params: {
          search: query,
          fields: FIELDS,
          limit: 20,
          sort: 'relevance',
        },
      });
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
      const { data } = await api.get(`/video/${videoId}`, {
        params: { fields: FIELDS },
      });
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
      const { data } = await api.get(`/video/${videoId}/related`, {
        params: { fields: FIELDS, limit: 10 },
      });
      return (data?.list ?? []).map(normalize);
    } catch (err) {
      console.warn('[DailymotionProvider] getRelated failed:', err.message);
      return [];
    }
  },
};
