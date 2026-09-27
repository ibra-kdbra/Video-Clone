import { apiGet } from './api.js';

/** Videos matching a query, with durations and view counts. */
export const searchVideos = async (query) => (await apiGet('youtube/search', { q: query })).items ?? [];

/** One video, including `channel` (name, avatar, subscriber count). */
export const getVideoDetails = async (videoId) => (await apiGet('youtube/video', { id: videoId })).item ?? null;

/** "Up next": more videos from the same channel. */
export const getRelatedVideos = async (videoId) => (await apiGet('youtube/related', { id: videoId })).items ?? [];

export const getChannelDetails = async (channelId) => (await apiGet('youtube/channel', { id: channelId })).item ?? null;

export const getChannelVideos = async (channelId) =>
  (await apiGet('youtube/channel-videos', { id: channelId })).items ?? [];

/** Top comments as plain text; `disabled` when the video has comments turned off. */
export const getCommentThreads = async (videoId) => apiGet('youtube/comments', { id: videoId });
