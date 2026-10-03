/** Seconds → "m:ss" or "h:mm:ss". Empty for unknown. */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
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

/** "12 lessons · 1 h 20 min · 30 students", skipping what's unknown. */
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

const DATE_TIME = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "Sep 3, 2026, 5:00 PM", in the reader's time zone. Empty for unknown dates. */
export function formatDateTime(iso) {
  const date = new Date(iso ?? '');
  return Number.isFinite(date.getTime()) ? DATE_TIME.format(date) : '';
}

/** "Active 3 days ago", or "Not started yet" when there's been no activity. */
export const lastActive = (iso, now = Date.now()) => (timeAgo(iso, now) ? `Active ${timeAgo(iso, now)}` : 'Not started yet');

/** Seconds → "0:00", "4:05" or "1:02:05", for a player's clock (zero included). */
export function formatClock(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

/** A course's running time: "1 h 20 min", "45 min", "40 sec". Empty for nothing. */
export function formatRuntime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'];

/** 1536 → "1.5 KB", 734003200 → "700 MB" (powers of 1024, like the API's messages). */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)} ${BYTE_UNITS[unit]}`;
}

/** "1 lesson", "3 lessons". */
export const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
