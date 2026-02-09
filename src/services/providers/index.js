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
 * Search across multiple providers in parallel.
 *
 * @param {string}   query            - Search query
 * @param {string[]} activeProviders  - Array of provider ids to include
 * @returns {Promise<import('./types.js').NormalizedVideo[]>}
 */
export const multiSearch = async (query, activeProviders = [PROVIDERS.YOUTUBE]) => {
  const providers = activeProviders
    .map((id) => providerMap[id])
    .filter(Boolean);

  const results = await Promise.allSettled(
    providers.map((p) => p.search(query)),
  );

  const successful = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);

  return interleave(successful);
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
