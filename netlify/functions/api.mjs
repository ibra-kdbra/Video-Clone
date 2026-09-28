import { handle } from '../../server/api/router.mjs';

/**
 * The app's only way to reach the video APIs. The keys come from the site's environment
 * variables (YOUTUBE_API_KEY, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET; all free) and never reach
 * the browser. Responses are cached at Netlify's CDN (see server/api/http.mjs).
 */
export default async (request) =>
  handle(request, {
    YOUTUBE_API_KEY: Netlify.env.get('YOUTUBE_API_KEY'),
    TWITCH_CLIENT_ID: Netlify.env.get('TWITCH_CLIENT_ID'),
    TWITCH_CLIENT_SECRET: Netlify.env.get('TWITCH_CLIENT_SECRET'),
  });

export const config = {
  path: '/api/*',
  // Each visitor gets 120 API calls a minute; cached responses don't count against the video APIs.
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
