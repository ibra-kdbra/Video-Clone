import { youtubeProvider } from './youtubeProvider.js';
import { twitchProvider } from './twitchProvider.js';
import { dailymotionProvider } from './dailymotionProvider.js';
import { PROVIDERS } from './types.js';

export { PROVIDERS, PROVIDER_LABELS } from './types.js';

/** Registry of available providers keyed by id */
const providerMap = {
  [PROVIDERS.YOUTUBE]: youtubeProvider,
  [PROVIDERS.TWITCH]: twitchProvider,
  [PROVIDERS.DAILYMOTION]: dailymotionProvider,
};

/**
 * Return the provider instance for a given id.
 */
export const getProvider = (id) => providerMap[id] ?? null;

/**
 * Interleave arrays round-robin so results from different providers mix nicely.
 * e.g. [yt1, tw1, dm1, yt2, tw2, dm2, ...]
 */
const interleave = (arrays) => {
  const result = [];
  const maxLen = Math.max(...arrays.map((a) => a.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const arr of arrays) {
      if (i < arr.length) result.push(arr[i]);
    }
  }
  return result;
};

/**
 * When YouTube can't search (its free tier allows 100 searches a day, or no key is set up yet),
 * Dailymotion fills in: it is free and needs no key, so the page still shows videos.
 */
const YOUTUBE_UNAVAILABLE = {
  quota:
    "YouTube's free daily search limit has been reached, so you're seeing videos from other platforms. YouTube is back after midnight Pacific time.",
  not_configured: "YouTube isn't connected yet, so you're seeing videos from other platforms.",
};

/**
 * Search across multiple providers in parallel.
 *
 * @param {string}   query            - Search query
 * @param {string[]} activeProviders  - Array of provider ids to include
 * @returns {Promise<{ videos: import('./types.js').NormalizedVideo[], notice: string | null }>}
 */
export const multiSearch = async (query, activeProviders = [PROVIDERS.YOUTUBE]) => {
  const ids = activeProviders.filter((id) => providerMap[id]);
  const results = await Promise.allSettled(ids.map((id) => providerMap[id].search(query)));

  const successful = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);

  let notice = null;
  const youtube = results[ids.indexOf(PROVIDERS.YOUTUBE)];
  const reason = youtube?.status === 'rejected' ? youtube.reason?.code : null;
  if (reason && YOUTUBE_UNAVAILABLE[reason]) {
    if (!ids.includes(PROVIDERS.DAILYMOTION)) successful.push(await dailymotionProvider.search(query));
    if (successful.some((list) => list.length)) notice = YOUTUBE_UNAVAILABLE[reason];
  }

  // If every platform failed (offline, service down…), say so instead of showing an empty feed.
  if (!successful.some((list) => list.length) && results.some((r) => r.status === 'rejected'))
    throw results.find((r) => r.status === 'rejected').reason;

  return { videos: interleave(successful), notice };
};

/**
 * Get video details from the right provider.
 *
 * @param {string} videoId
 * @param {string} provider  - Provider id
 */
export const getDetails = async (videoId, provider = PROVIDERS.YOUTUBE) => {
  const p = providerMap[provider];
  if (!p) return null;
  return p.getDetails(videoId);
};

/**
 * Get related videos from the right provider.
 */
export const getRelated = async (videoId, provider = PROVIDERS.YOUTUBE) => {
  const p = providerMap[provider];
  if (!p) return [];
  return p.getRelated(videoId);
};
