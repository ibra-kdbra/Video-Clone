import axios from 'axios';
import { PROVIDERS } from './types.js';

const BASE_URL = 'https://twitch-api7.p.rapidapi.com';

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'X-RapidAPI-Host': 'twitch-api7.p.rapidapi.com',
  },
});

api.interceptors.request.use((config) => {
  const key = import.meta.env.VITE_RAPID_API_KEY;
  if (key) config.headers['X-RapidAPI-Key'] = key;
  return config;
});

/**
 * Normalize a Twitch clip / stream / VOD into the common video shape.
 * The exact field names vary between RapidAPI Twitch wrappers, so we
 * attempt multiple field paths with safe fallbacks.
 */
const normalize = (item) => {
  const id = item?.id ?? item?.clip_id ?? item?.slug ?? '';
  const title = item?.title ?? item?.name ?? '';
  const thumbnail =
    item?.thumbnail_url?.replace('{width}', '640')?.replace('{height}', '360') ??
    item?.preview?.medium ??
    item?.thumbnails?.[0]?.url ??
    '';
  const channelTitle =
    item?.broadcaster_name ?? item?.channel?.display_name ?? item?.user_name ?? '';
  const channelId =
    item?.broadcaster_id ?? item?.channel?.name ?? item?.user_id ?? '';
  const publishedAt = item?.created_at ?? item?.published_at ?? '';
  const viewCount = String(item?.view_count ?? item?.views ?? '');

  return {
    id,
    provider: PROVIDERS.TWITCH,
    title,
    thumbnail,
    channelTitle,
    channelId,
    publishedAt,
    viewCount,
    duration: item?.duration ?? '',
    description: item?.description ?? '',
    playerUrl: `https://www.twitch.tv/videos/${id}`,
    _raw: item,
  };
};

export const twitchProvider = {
  id: PROVIDERS.TWITCH,

  /**
   * Search Twitch clips / channels by query.
   */
  search: async (query) => {
    try {
      const { data } = await api.get('/clips/search', {
        params: { query, page_size: 20 },
      });
      const items = Array.isArray(data) ? data : (data?.data ?? data?.clips ?? []);
      return items.map(normalize);
    } catch (err) {
      console.warn('[TwitchProvider] search failed:', err.message);
      return [];
    }
  },

  /**
   * Get clip / video details by id.
   */
  getDetails: async (videoId) => {
    try {
      const { data } = await api.get('/clips', {
        params: { id: videoId },
      });
      const item = Array.isArray(data) ? data[0] : (data?.data?.[0] ?? data);
      return item ? normalize(item) : null;
    } catch (err) {
      console.warn('[TwitchProvider] getDetails failed:', err.message);
      return null;
    }
  },

  /**
   * "Related" isn't a native Twitch concept — return top clips instead.
   */
  getRelated: async () => {
    try {
      const { data } = await api.get('/clips/trending', {
        params: { page_size: 10 },
      });
      const items = Array.isArray(data) ? data : (data?.data ?? data?.clips ?? []);
      return items.map(normalize);
    } catch (err) {
      console.warn('[TwitchProvider] getRelated failed:', err.message);
      return [];
    }
  },
};
