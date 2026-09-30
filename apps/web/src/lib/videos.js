import { apiGet } from './api.js';
import { SOURCES } from './sources.js';

/**
 * YouTube search ignores case and extra spaces, so queries are normalized first: "React" and
 * "react " then share one cached response (the free tier allows 100 searches a day).
 */
export const normalizeQuery = (q) => String(q ?? '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 100);

/** Round-robin, so the platforms mix: [yt1, dm1, yt2, dm2, …]. */
function interleave(lists) {
  const result = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) for (const list of lists) if (i < list.length) result.push(list[i]);
  return result;
}

/** When YouTube can't answer, Dailymotion (free, no key) fills in and a note says why. */
const YOUTUBE_UNAVAILABLE = {
  quota: "YouTube's free daily limit has been reached, so you're seeing videos from other platforms. YouTube is back after midnight Pacific time.",
  not_configured: "YouTube isn't connected yet, so you're seeing videos from other platforms.",
};

/**
 * Loads a list from each chosen platform in parallel and mixes the results. Twitch is optional:
 * when it isn't set up on the server it simply contributes nothing.
 *
 * @returns {Promise<{ videos: import('../../server/api/video.mjs').Video[], notice: string | null }>}
 */
async function fromSources(sources, load) {
  const chosen = SOURCES.filter((source) => sources.includes(source));
  const results = await Promise.allSettled(chosen.map((source) => load(source)));
  const lists = [];
  const failures = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') lists.push(result.value.items ?? []);
    else if (!(chosen[i] === 'twitch' && result.reason?.code === 'not_configured')) failures.push([chosen[i], result.reason]);
  });

  let notice = null;
  const youtube = failures.find(([source]) => source === 'youtube')?.[1];
  if (youtube && YOUTUBE_UNAVAILABLE[youtube.code]) {
    if (!chosen.includes('dailymotion')) {
      try {
        lists.push((await load('dailymotion')).items ?? []);
      } catch {
        // Nothing more to fall back to; the error below covers it.
      }
    }
    if (lists.some((list) => list.length)) notice = YOUTUBE_UNAVAILABLE[youtube.code];
  }

  // Every platform failed (offline, service down…): say so instead of showing an empty page.
  if (!lists.some((list) => list.length) && failures.length) throw failures[0][1];
  return { videos: interleave(lists), notice };
}

export const searchVideos = (q, sources) => fromSources(sources, (source) => apiGet(`${source}/search`, { q: normalizeQuery(q) }));

export const trendingVideos = (sources) => fromSources(sources, (source) => apiGet(`${source}/trending`));

export const categoryVideos = (category, sources) => (category.trending ? trendingVideos(sources) : searchVideos(category.query, sources));

export const getVideo = async (provider, id) => (await apiGet(`${provider}/${provider === 'twitch' ? 'clip' : 'video'}`, { id })).item;

export const getRelated = async (provider, id) => (await apiGet(`${provider}/related`, { id })).items ?? [];

export const getChannel = async (id) => (await apiGet('youtube/channel', { id })).item;

export const getChannelVideos = (id, pageToken) => apiGet('youtube/channel-videos', { id, pageToken });

export const getComments = (id) => apiGet('youtube/comments', { id });
