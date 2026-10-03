import { safeUrl, text } from './http.mjs';

/**
 * The one video shape every endpoint returns, whatever the platform: what a lesson that embeds the
 * video shows (in the course editor, and on the player's poster). Only these fields leave the
 * server.
 *
 * @typedef {Object} Video
 * @property {'youtube'|'dailymotion'|'twitch'} provider
 * @property {string}  id
 * @property {string}  title
 * @property {string|null} thumbnail  The default image
 * @property {{url: string, width: number}[]} thumbnails  Sizes, smallest first
 * @property {number|null} duration  Seconds
 */
export function video({ provider, id, title, thumbnail = null, thumbnails = [], duration = null }) {
  return {
    provider,
    id: String(id),
    title: text(title, 300) || 'Untitled video',
    thumbnail: safeUrl(thumbnail),
    thumbnails: thumbnails
      .map((t) => ({ url: safeUrl(t?.url), width: Number(t?.width) }))
      .filter((t) => t.url && Number.isFinite(t.width) && t.width > 0)
      .sort((a, b) => a.width - b.width),
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
  };
}
