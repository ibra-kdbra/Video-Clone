import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'fundastream_watch_later';

export const useWatchLater = () => {
  const [watchLater, setWatchLater] = useState([]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setWatchLater(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse watch later list', e);
      }
    }
  }, []);

  const isInWatchLater = useCallback(
    (videoId) => watchLater.some((v) => {
      const id = typeof v.id === 'object' ? v.id?.videoId : v.id;
      return id === videoId;
    }),
    [watchLater]
  );

  const addToWatchLater = useCallback((video) => {
    if (!video) return;
    const videoId = typeof video.id === 'object' ? video.id?.videoId : video.id;
    if (!videoId) return;

    setWatchLater((prev) => {
      const exists = prev.some((v) => {
        const id = typeof v.id === 'object' ? v.id?.videoId : v.id;
        return id === videoId;
      });
      if (exists) return prev;
      const updated = [video, ...prev];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeFromWatchLater = useCallback((videoId) => {
    setWatchLater((prev) => {
      const updated = prev.filter((v) => {
        const id = typeof v.id === 'object' ? v.id?.videoId : v.id;
        return id !== videoId;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const toggleWatchLater = useCallback((video) => {
    const videoId = typeof video.id === 'object' ? video.id?.videoId : video.id;
    if (isInWatchLater(videoId)) {
      removeFromWatchLater(videoId);
      return false; // removed
    } else {
      addToWatchLater(video);
      return true; // added
    }
  }, [isInWatchLater, addToWatchLater, removeFromWatchLater]);

  const clearWatchLater = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setWatchLater([]);
  }, []);

  return { watchLater, addToWatchLater, removeFromWatchLater, toggleWatchLater, isInWatchLater, clearWatchLater };
};
