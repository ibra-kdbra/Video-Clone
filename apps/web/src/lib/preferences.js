import { createStore, useStore } from './store.js';

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
