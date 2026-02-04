import axios from 'axios';

const BASE_URL = 'https://youtube-v31.p.rapidapi.com';

const apiKey = import.meta.env.VITE_RAPID_API_KEY;

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'X-RapidAPI-Key': apiKey,
    'X-RapidAPI-Host': 'youtube-v31.p.rapidapi.com',
  },
  params: {
    maxResults: 50,
  },
});

const ensureApiKey = () => {
  if (!apiKey) {
    throw new Error('Missing RapidAPI key. Set VITE_RAPID_API_KEY in your environment.');
  }
};

export const searchVideos = async (query) => {
  ensureApiKey();
  const { data } = await api.get('/search', {
    params: {
      part: 'snippet',
      q: query,
      type: 'video',
    },
  });
  return data?.items ?? [];
};

export const getVideoDetails = async (videoId) => {
  ensureApiKey();
  const { data } = await api.get('/videos', {
    params: {
      part: 'snippet,statistics',
      id: videoId,
    },
  });
  return data?.items?.[0] ?? null;
};

export const getRelatedVideos = async (videoId) => {
  ensureApiKey();
  const { data } = await api.get('/search', {
    params: {
      part: 'snippet',
      relatedToVideoId: videoId,
      type: 'video',
    },
  });
  return data?.items ?? [];
};

export const getChannelDetails = async (channelId) => {
  ensureApiKey();
  const { data } = await api.get('/channels', {
    params: {
      part: 'snippet,statistics',
      id: channelId,
    },
  });
  return data?.items?.[0] ?? null;
};

export const getChannelVideos = async (channelId) => {
  ensureApiKey();
  const { data } = await api.get('/search', {
    params: {
      channelId,
      part: 'snippet,id',
      order: 'date',
      type: 'video',
    },
  });
  return data?.items ?? [];
};
