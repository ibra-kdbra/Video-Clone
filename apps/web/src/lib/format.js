/** Seconds → "m:ss" or "h:mm:ss". Empty for unknown. */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** 1234 → "1.2K", 3400000 → "3.4M". Empty for missing or hidden counts. */
export function formatCount(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? compact.format(n) : '';
}

/** "1.2M views", "1 view", or empty. */
export function formatViews(value) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return '';
  return n === 1 ? '1 view' : `${formatCount(n)} views`;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 days ago", "last week", "just now". Empty for unknown dates. */
export function timeAgo(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.round((then - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** A `srcset` from a video's thumbnail sizes, so each card downloads the size it shows. */
export function srcSet(thumbnails = []) {
  return thumbnails
    .filter((t) => t?.url && t?.width)
    .map((t) => `${t.url} ${t.width}w`)
    .join(', ');
}

/** "Channel · 1.2M views · 3 days ago", skipping what's unknown. */
export const joinMeta = (...parts) => parts.filter(Boolean).join(' · ');

const DATE_STYLES = {
  day: new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }),
  month: new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }),
};

/** "Sep 3, 2026" (`day`) or "September 2026" (`month`). Empty for unknown dates. */
export function formatDate(iso, style = 'day') {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? DATE_STYLES[style].format(date) : '';
}
