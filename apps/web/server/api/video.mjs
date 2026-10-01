import { safeUrl, text } from './http.mjs';

/**
 * The one video shape every endpoint returns, whatever the source, so the app renders YouTube,
 * Dailymotion and Twitch the same way. Only these fields leave the server.
 *
 * @typedef {Object} Video
 * @property {'youtube'|'dailymotion'|'twitch'} provider
 * @property {string}  id
 * @property {string}  title
 * @property {string}  description   Plain text (no HTML)
 * @property {string|null} thumbnail  The default image
 * @property {{url: string, width: number}[]} thumbnails  Sizes for srcset, smallest first
 * @property {{id: string|null, title: string, avatar: string|null, subscribers: number|null}} channel
 * @property {string|null} publishedAt  ISO 8601
 * @property {number|null} views
 * @property {number|null} likes
 * @property {number|null} duration  Seconds
 * @property {boolean} live
 */
export function video({
  provider,
  id,
  title,
  description = '',
  thumbnail = null,
  thumbnails = [],
  channel = {},
  publishedAt = null,
  views = null,
  likes = null,
  duration = null,
  live = false,
}) {
  return {
    provider,
    id: String(id),
    title: text(title, 300) || 'Untitled video',
    description: text(description),
    thumbnail: safeUrl(thumbnail),
    thumbnails: thumbnails
      .map((t) => ({ url: safeUrl(t?.url), width: Number(t?.width) }))
      .filter((t) => t.url && Number.isFinite(t.width) && t.width > 0)
      .sort((a, b) => a.width - b.width),
    channel: {
      id: channel.id ? String(channel.id) : null,
      title: text(channel.title, 200),
      avatar: safeUrl(channel.avatar),
      subscribers: channel.subscribers ?? null,
    },
    publishedAt: publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? new Date(publishedAt).toISOString() : null,
    views,
    likes,
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    live: Boolean(live),
  };
}
