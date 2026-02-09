/**
 * Normalized video shape used across all providers.
 *
 * Every provider must map its API response into this structure
 * so the UI components remain provider-agnostic.
 *
 * @typedef {Object} NormalizedVideo
 * @property {string}  id              - Unique video / clip / VOD id
 * @property {string}  provider        - 'youtube' | 'twitch' | 'dailymotion'
 * @property {string}  title           - Video title
 * @property {string}  thumbnail       - URL to the thumbnail image
 * @property {string}  channelTitle    - Channel / streamer display name
 * @property {string}  channelId       - Channel identifier (provider-specific)
 * @property {string}  [publishedAt]   - ISO 8601 date string
 * @property {string}  [viewCount]     - View count as a string
 * @property {string}  [duration]      - Duration string (e.g. "12:45")
 * @property {string}  [description]   - Full description text
 * @property {string}  playerUrl       - URL that react-player can play
 */

/** Provider identifiers */
export const PROVIDERS = Object.freeze({
  YOUTUBE: 'youtube',
  TWITCH: 'twitch',
  DAILYMOTION: 'dailymotion',
});

/** Default provider order for UI display */
export const PROVIDER_LABELS = Object.freeze({
  [PROVIDERS.YOUTUBE]: 'YouTube',
  [PROVIDERS.TWITCH]: 'Twitch',
  [PROVIDERS.DAILYMOTION]: 'Dailymotion',
});
