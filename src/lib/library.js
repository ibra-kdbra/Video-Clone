import { createStore, useStore } from './store.js';
import { CHANNEL_ID, isValidId } from './sources.js';

/**
 * Watch history and saved videos, kept in this browser only. Entries are small copies of a video
 * (enough to show a card), validated field by field whenever they're read back.
 */
const LIMITS = { history: 100, saved: 200 };

const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const num = (value) => (Number.isFinite(value) && value >= 0 ? value : null);
const safeImage = (value) => (typeof value === 'string' && (/^https:\/\//.test(value) || /^\/__mock\//.test(value)) ? value : null);
const iso = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null);

/** A stored copy of a video, or null when the input isn't a valid video. */
export function toEntry(video, at = new Date().toISOString()) {
  if (!video || !isValidId(video.provider, video.id)) return null;
  const channelId = str(video.channel?.id, 60);
  return {
    provider: video.provider,
    id: video.id,
    title: str(video.title, 300) || 'Untitled video',
    thumbnail: safeImage(video.thumbnail),
    thumbnails: Array.isArray(video.thumbnails)
      ? video.thumbnails
          .map((t) => ({ url: safeImage(t?.url), width: num(t?.width) }))
          .filter((t) => t.url && t.width)
          .slice(0, 5)
      : [],
    channel: {
      id: video.provider === 'youtube' ? (CHANNEL_ID.test(channelId) ? channelId : null) : /^[A-Za-z0-9_-]{1,60}$/.test(channelId) ? channelId : null,
      title: str(video.channel?.title, 200),
    },
    duration: num(video.duration),
    views: num(video.views),
    publishedAt: iso(video.publishedAt),
    at: iso(video.at) ?? at,
  };
}

const readList = (kind) => (value) =>
  Array.isArray(value)
    ? value
        .map((item) => toEntry(item, item?.at))
        .filter(Boolean)
        .slice(0, LIMITS[kind])
    : [];

/**
 * Lists saved by earlier versions (raw YouTube items under other keys) are carried over once.
 */
function migrate(oldKey, newKey) {
  try {
    if (localStorage.getItem(newKey) !== null) return;
    const old = JSON.parse(localStorage.getItem(oldKey) ?? 'null');
    if (!Array.isArray(old)) return;
    const converted = old.map((item) => {
      if (item?.provider) return { ...item, channel: { id: item.channelId, title: item.channelTitle } };
      const id = typeof item?.id === 'object' ? item.id?.videoId : item?.id;
      const s = item?.snippet ?? {};
      return { provider: 'youtube', id, title: s.title, thumbnail: s.thumbnails?.high?.url, channel: { id: s.channelId, title: s.channelTitle }, publishedAt: s.publishedAt };
    });
    localStorage.setItem(newKey, JSON.stringify(converted.map((item) => toEntry(item)).filter(Boolean)));
    localStorage.removeItem(oldKey);
  } catch {
    // Unreadable old data is simply dropped.
  }
}

try {
  migrate('fundastream_watch_history', 'fs.history.v2');
  migrate('fundastream_watch_later', 'fs.saved.v2');
  localStorage.removeItem('fundastream_likes');
} catch {
  // Storage is blocked (some private modes): the app works without it.
}

const stores = {
  history: createStore('fs.history.v2', readList('history'), []),
  saved: createStore('fs.saved.v2', readList('saved'), []),
};

const same = (a, b) => a.provider === b.provider && a.id === b.id;

export const library = {
  /** Adds (or moves to the top) a video. Returns false when the video isn't valid. */
  add(kind, video) {
    const entry = toEntry(video);
    if (!entry) return false;
    stores[kind].set((list) => [entry, ...list.filter((item) => !same(item, entry))].slice(0, LIMITS[kind]));
    return true;
  },
  remove(kind, video) {
    stores[kind].set((list) => list.filter((item) => !same(item, video)));
  },
  clear(kind) {
    stores[kind].set([]);
  },
  has(kind, video) {
    return stores[kind].get().some((item) => same(item, video));
  },
  /** Saves or unsaves; returns whether it's saved now. */
  toggleSaved(video) {
    if (library.has('saved', video)) {
      library.remove('saved', video);
      return false;
    }
    return library.add('saved', video);
  },
};

export const useHistory = () => useStore(stores.history);
export const useSaved = () => useStore(stores.saved);
export const useIsSaved = (video) => useSaved().some((item) => video && same(item, video));
