import { createStore, useStore } from './store.js';
import { SOURCES } from './sources.js';

/** Which platforms to show. At least one stays on. */
const sources = createStore(
  'fs.sources',
  (value) => {
    const picked = Array.isArray(value) ? SOURCES.filter((s) => value.includes(s)) : [];
    return picked.length ? picked : ['youtube', 'dailymotion'];
  },
  ['youtube', 'dailymotion'],
);

export const useSources = () => useStore(sources);
export const getSources = () => sources.get();

export function toggleSource(source) {
  sources.set((current) => {
    if (!current.includes(source)) return SOURCES.filter((s) => s === source || current.includes(s));
    return current.length > 1 ? current.filter((s) => s !== source) : current;
  });
}

/** Recent searches, newest first. */
const recent = createStore(
  'fs.recent',
  (value) => (Array.isArray(value) ? value.filter((q) => typeof q === 'string' && q.trim()).map((q) => q.slice(0, 100)).slice(0, 8) : []),
  [],
);

export const useRecentSearches = () => useStore(recent);

export function rememberSearch(q) {
  const clean = String(q).trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!clean) return;
  recent.set((list) => [clean, ...list.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 8));
}

export const forgetSearch = (q) => recent.set((list) => list.filter((item) => item !== q));
export const clearSearches = () => recent.set([]);

/**
 * Light or dark. Stored as an explicit choice; with none, the system setting decides (index.html
 * applies it before the first paint, so there's no flash).
 */
const theme = createStore('fs.theme', (value) => (value === 'light' || value === 'dark' ? value : null), null);

export const systemTheme = () => (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

export function useTheme() {
  return useStore(theme) ?? systemTheme();
}

export function setTheme(next) {
  theme.set(next);
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#fafafa' : '#09090b');
}
