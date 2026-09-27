import { apiGet } from '../api.js';
import { formatDuration } from '../../utils/format.js';
import { PROVIDERS } from './types.js';

/**
 * Normalize a Twitch clip (Helix API, via our server) into the common video shape.
 */
const normalize = (clip) => ({
  id: clip?.id ?? '',
  provider: PROVIDERS.TWITCH,
  title: clip?.title ?? '',
  thumbnail: clip?.thumbnail_url ?? '',
  channelTitle: clip?.broadcaster_name ?? '',
  channelId: clip?.broadcaster_id ?? '',
  publishedAt: clip?.created_at ?? '',
  viewCount: String(clip?.view_count ?? ''),
  duration: formatDuration(clip?.duration),
  description: '',
  // Clips live at clips.twitch.tv, not twitch.tv/videos.
  playerUrl: clip?.url ?? `https://clips.twitch.tv/${clip?.id ?? ''}`,
  _raw: clip,
});

/** Twitch is optional: when it isn't set up on the server, it simply contributes nothing. */
const quietly = async (request, fallback) => {
  try {
    return await request();
  } catch (error) {
    if (error?.code !== 'not_configured') console.warn('[TwitchProvider]', error.message);
    return fallback;
  }
};

export const twitchProvider = {
  id: PROVIDERS.TWITCH,

  search: (query) =>
    quietly(async () => (await apiGet('twitch/search', { q: query })).items.map(normalize), []),

  getDetails: (clipId) =>
    quietly(async () => normalize((await apiGet('twitch/clip', { id: clipId })).item), null),

  /** "Related" isn't a Twitch concept: this week's top clips instead. */
  getRelated: () => quietly(async () => (await apiGet('twitch/trending')).items.map(normalize), []),
};

export { normalize as normalizeTwitch };
