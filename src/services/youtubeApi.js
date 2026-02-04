import axios from 'axios';

const BASE_URL = 'https://youtube-v31.p.rapidapi.com';

const getApiKey = () => import.meta.env.VITE_RAPID_API_KEY;

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'X-RapidAPI-Host': 'youtube-v31.p.rapidapi.com',
  },
  params: {
    maxResults: 50,
  },
});

// Use interceptor to ensure API key is present on every request
api.interceptors.request.use((config) => {
  const key = getApiKey();
  if (!key) {
    console.error('RapidAPI Key is missing! Check your environment variables.');
    throw new Error('Missing RapidAPI key. Please set VITE_RAPID_API_KEY.');
  }
  config.headers['X-RapidAPI-Key'] = key;
  return config;
});

export const searchVideos = async (query) => {
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
  const { data } = await api.get('/videos', {
    params: {
      part: 'snippet,statistics',
      id: videoId,
    },
  });
  return data?.items?.[0] ?? null;
};

export const getRelatedVideos = async (videoId) => {
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
  const { data } = await api.get('/channels', {
    params: {
      part: 'snippet,statistics',
      id: channelId,
    },
  });
  return data?.items?.[0] ?? null;
};

export const getChannelVideos = async (channelId) => {
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
