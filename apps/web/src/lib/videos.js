import { apiGet } from './api.js';

/**
 * A linked lesson video's details from its platform: `title`, `thumbnail`, `thumbnails` (smallest
 * first) and `duration` in seconds, through the app's own video proxy (server/api), which holds
 * the platforms' keys. Lessons play without them: callers fall back to YouTube's standard picture
 * and the lesson's own title.
 *
 * @returns {Promise<import('../../server/api/video.mjs').Video>}
 */
export const getVideo = async (provider, id) => (await apiGet(`${provider}/${provider === 'twitch' ? 'clip' : 'video'}`, { id })).item;
