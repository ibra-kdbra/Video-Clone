/**
 * The video platforms a lesson (or a live class) can embed: their names, addresses, players and
 * pictures. Which ids each accepts is the API's EMBED_REF_FORMAT (see videoLinks.js).
 */
export const SOURCE_LABELS = { youtube: 'YouTube', dailymotion: 'Dailymotion', twitch: 'Twitch' };

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
