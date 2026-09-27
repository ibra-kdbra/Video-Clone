import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'fundastream_watch_history';
const MAX_HISTORY = 50;

/** Search results carry `{ videoId }`, video details a plain string id. */
const idOf = (video) => (typeof video?.id === 'object' ? video.id?.videoId : video?.id);

export const useWatchHistory = () => {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse watch history', e);
      }
    }
  }, []);

  const addToHistory = useCallback((video) => {
    const id = idOf(video);
    if (!id) return;

    setHistory((prev) => {
      // Move it to the top if it's already there. (This used to compare `id.videoId`, which is
      // undefined for video details, so every new entry wiped out the rest of the history.)
      const filtered = prev.filter((v) => idOf(v) !== id);
      const updated = [video, ...filtered].slice(0, MAX_HISTORY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeFromHistory = (videoId) => {
    setHistory((prev) => {
      const updated = prev.filter((v) => idOf(v) !== videoId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const clearHistory = () => {
    localStorage.removeItem(STORAGE_KEY);
    setHistory([]);
  };

  return { history, addToHistory, removeFromHistory, clearHistory };
};
