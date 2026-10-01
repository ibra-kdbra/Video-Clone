/** The video platforms, their labels, and how their ids look. */
export const SOURCES = ['youtube', 'dailymotion', 'twitch'];

export const SOURCE_LABELS = { youtube: 'YouTube', dailymotion: 'Dailymotion', twitch: 'Twitch' };

export const ID_PATTERNS = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  dailymotion: /^x[A-Za-z0-9]{2,15}$/,
  twitch: /^[A-Za-z0-9_-]{1,100}$/,
};

export const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export const isSource = (value) => SOURCES.includes(value);

export const isValidId = (provider, id) => isSource(provider) && typeof id === 'string' && ID_PATTERNS[provider].test(id);

/** The in-app page for a video. */
export const watchPath = (video) => `/watch/${video.provider}/${encodeURIComponent(video.id)}`;

/** The video on its own site. */
export function externalUrl(provider, id) {
  if (provider === 'youtube') return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  if (provider === 'dailymotion') return `https://www.dailymotion.com/video/${encodeURIComponent(id)}`;
  return `https://clips.twitch.tv/${encodeURIComponent(id)}`;
}

/**
 * The embedded player. YouTube's privacy-enhanced domain sets no cookies until the video plays;
 * Twitch requires the embedding site's hostname as `parent`.
 */
export function embedUrl(provider, id, hostname = window.location.hostname) {
  const safeId = encodeURIComponent(id);
  if (provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${safeId}?autoplay=1&rel=0&playsinline=1`;
  if (provider === 'dailymotion') return `https://www.dailymotion.com/embed/video/${safeId}?autoplay=1`;
  return `https://clips.twitch.tv/embed?clip=${safeId}&parent=${encodeURIComponent(hostname)}&autoplay=true`;
}

/** A video's preview image when it needs no lookup (YouTube's), or null. */
export const directThumbnail = (provider, id) => (provider === 'youtube' ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg` : null);
