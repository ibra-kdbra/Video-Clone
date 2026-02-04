import { useState, useEffect } from 'react';

const STORAGE_KEY = 'fundastream_watch_history';
const MAX_HISTORY = 50;

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

  const addToHistory = (video) => {
    if (!video || !video.id) return;

    setHistory((prev) => {
      // Remove if already exists to move it to the top
      const filtered = prev.filter((v) => v.id.videoId !== video.id.videoId);
      const updated = [video, ...filtered].slice(0, MAX_HISTORY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const removeFromHistory = (videoId) => {
    setHistory((prev) => {
      const updated = prev.filter((v) => v.id.videoId !== videoId);
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
