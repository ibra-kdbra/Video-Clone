import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'fundastream_likes';

export const useLikes = () => {
  const [likes, setLikes] = useState({});

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setLikes(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse likes data', e);
      }
    }
  }, []);

  const isLiked = useCallback(
    (videoId) => Boolean(likes[videoId]),
    [likes]
  );

  const toggleLike = useCallback((videoId) => {
    setLikes((prev) => {
      const updated = { ...prev };
      if (updated[videoId]) {
        delete updated[videoId];
      } else {
        updated[videoId] = true;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return { isLiked, toggleLike };
};
