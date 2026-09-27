/**
 * Turns a duration into "m:ss" or "h:mm:ss". Accepts YouTube's ISO 8601 form ("PT1H2M3S"), or a
 * number of seconds (Twitch, Dailymotion). Live streams ("P0D") read "LIVE".
 */
export function formatDuration(value) {
  let seconds;
  if (typeof value === 'number') seconds = value;
  else if (typeof value === 'string') {
    if (value === 'P0D') return 'LIVE';
    const match = value.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
    if (!match) return '';
    const [, d = 0, h = 0, m = 0, s = 0] = match;
    seconds = Number(d) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s);
  } else return '';

  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

/** 1234 → "1.2K", 3400000 → "3.4M". Empty for missing or hidden counts. */
export function formatCount(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return '';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/**
 * A `srcset` from YouTube's thumbnail set, so each card downloads the size it shows
 * (320, 480, 640 or 1280 px wide) instead of always the 480 px one.
 */
export function thumbnailSrcSet(thumbnails = {}) {
  return ['medium', 'high', 'standard', 'maxres']
    .map((size) => thumbnails[size])
    .filter((t) => t?.url && t?.width)
    .map((t) => `${t.url} ${t.width}w`)
    .join(', ');
}
