import { searchVideos as ytSearch, getVideoDetails as ytDetails, getRelatedVideos as ytRelated } from '../youtubeApi.js';
import { PROVIDERS } from './types.js';

/**
 * Normalize a raw YouTube API item (from /search or /videos) into the common shape.
 */
const normalize = (item) => {
  const snippet = item?.snippet ?? {};
  const rawId = typeof item?.id === 'object' ? item.id.videoId : item?.id;

  return {
    id: rawId,
    provider: PROVIDERS.YOUTUBE,
    title: snippet.title ?? '',
    thumbnail: snippet.thumbnails?.high?.url ?? snippet.thumbnails?.medium?.url ?? '',
    channelTitle: snippet.channelTitle ?? '',
    channelId: snippet.channelId ?? '',
    publishedAt: snippet.publishedAt ?? '',
    viewCount: item?.statistics?.viewCount ?? '',
    duration: '',
    description: snippet.description ?? '',
    playerUrl: `https://www.youtube.com/watch?v=${rawId}`,
    // Keep original payload so existing components still work
    _raw: item,
  };
};

export const youtubeProvider = {
  id: PROVIDERS.YOUTUBE,

  /** Search videos by query string – returns NormalizedVideo[] */
  search: async (query) => {
    const items = await ytSearch(query);
    return items.map(normalize);
  },

  /** Get full video details by id – returns NormalizedVideo | null */
  getDetails: async (videoId) => {
    const item = await ytDetails(videoId);
    return item ? normalize(item) : null;
  },

  /** Get related / suggested videos – returns NormalizedVideo[] */
  getRelated: async (videoId) => {
    const items = await ytRelated(videoId);
    return items.map(normalize);
  },
};
