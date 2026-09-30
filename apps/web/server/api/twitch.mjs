import { ApiError, PATTERNS, count, need, query, upstream } from './http.mjs';
import { video } from './video.mjs';

const HELIX = 'https://api.twitch.tv/helix';
const DAY = 24 * 3600 * 1000;

/** The app access token (client-credentials flow), reused until shortly before it expires. */
let token = null;

export function resetTwitchToken() {
  token = null;
}

function credentials(env) {
  const { TWITCH_CLIENT_ID: id, TWITCH_CLIENT_SECRET: secret } = env;
  if (!id || !secret) throw new ApiError(503, 'not_configured', 'Twitch is not set up yet (missing credentials on the server).');
  return { id, secret };
}

async function appToken(ctx) {
  const { id, secret } = credentials(ctx.env);
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const response = await upstream(
    ctx,
    'https://id.twitch.tv/oauth2/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }),
    },
    'Twitch token',
  );
  if (!response.ok) {
    console.error(`[api] Twitch token request failed: ${response.status}`);
    throw new ApiError(502, 'upstream_error', 'Could not sign in to Twitch.');
  }
  const data = await response.json();
  token = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return token.value;
}

async function helix(ctx, path, params, retried = false) {
  const url = new URL(HELIX + path);
  for (const [name, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(name, String(value));
  const response = await upstream(
    ctx,
    url,
    { headers: { 'Client-Id': credentials(ctx.env).id, Authorization: `Bearer ${await appToken(ctx)}` } },
    `Twitch ${path}`,
  );
  if (response.status === 401 && !retried) {
    token = null;
    return helix(ctx, path, params, true);
  }
  if (response.status === 429) throw new ApiError(429, 'quota', 'Twitch is limiting requests right now. Please try again shortly.');
  if (!response.ok) {
    console.error(`[api] Twitch ${path} failed: ${response.status}`);
    throw new ApiError(502, 'upstream_error', 'Twitch did not respond as expected.');
  }
  return response.json();
}

const since = (days) => new Date(Date.now() - days * DAY).toISOString();

/** Clip thumbnails are 480 px wide. */
const toVideo = (clip) =>
  video({
    provider: 'twitch',
    id: clip.id,
    title: clip.title,
    thumbnail: clip.thumbnail_url,
    thumbnails: [{ url: clip.thumbnail_url, width: 480 }],
    channel: { id: clip.broadcaster_id, title: clip.broadcaster_name },
    publishedAt: clip.created_at,
    views: count(clip.view_count),
    duration: clip.duration,
  });

async function clipsFor(ctx, filter, days, first) {
  const data = await helix(ctx, '/clips', { ...filter, first, started_at: since(days) });
  return (data.data ?? []).filter((clip) => typeof clip?.id === 'string').map(toVideo);
}

export const twitch = {
  /**
   * Clips for a search: the best-matching game or category ("Music", "Software and Game
   * Development"…), or else the best-matching channel.
   */
  async search(params, ctx) {
    const q = query(params);
    const categories = await helix(ctx, '/search/categories', { query: q, first: 1 });
    const gameId = categories.data?.[0]?.id;
    let items = gameId ? await clipsFor(ctx, { game_id: gameId }, 30, 20) : [];
    if (!items.length) {
      const channels = await helix(ctx, '/search/channels', { query: q, first: 1 });
      const broadcasterId = channels.data?.[0]?.id;
      if (broadcasterId) items = await clipsFor(ctx, { broadcaster_id: broadcasterId }, 365, 20);
    }
    return { body: { items }, ttl: 6 * 3600 };
  },

  async clip(params, ctx) {
    const id = need(params, 'id', PATTERNS.clipId);
    const data = await helix(ctx, '/clips', { id });
    const clip = data.data?.[0];
    if (!clip) throw new ApiError(404, 'not_found', 'That clip was not found.');
    return { body: { item: toVideo(clip) }, ttl: 3600 };
  },

  /** This week's top clips from the most-watched game. */
  async trending(_params, ctx) {
    const games = await helix(ctx, '/games/top', { first: 1 });
    const gameId = games.data?.[0]?.id;
    const items = gameId ? await clipsFor(ctx, { game_id: gameId }, 7, 20) : [];
    return { body: { items }, ttl: 3600 };
  },

  /** "Up next": the same streamer's top clips of the past year. */
  async related(params, ctx) {
    const id = need(params, 'id', PATTERNS.clipId);
    const data = await helix(ctx, '/clips', { id });
    const broadcasterId = data.data?.[0]?.broadcaster_id;
    if (!broadcasterId) return { body: { items: [] }, ttl: 3600 };
    const items = await clipsFor(ctx, { broadcaster_id: broadcasterId }, 365, 17);
    return { body: { items: items.filter((item) => item.id !== id).slice(0, 16) }, ttl: 3600 };
  },
};
