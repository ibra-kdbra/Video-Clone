import { ApiError, PATTERNS, decodeEntities, need, query } from './http.mjs';

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
  const response = await ctx.fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }),
  });
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
  const response = await ctx.fetch(url, {
    headers: { 'Client-Id': credentials(ctx.env).id, Authorization: `Bearer ${await appToken(ctx)}` },
  });
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
const clean = (clip) => ({ ...clip, title: decodeEntities(clip.title) });

async function clipsFor(ctx, filter, days, first) {
  const data = await helix(ctx, '/clips', { ...filter, first, started_at: since(days) });
  return (data.data ?? []).map(clean);
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
    return { body: { items }, ttl: 1800 };
  },

  async clip(params, ctx) {
    const id = need(params, 'id', PATTERNS.clipId);
    const data = await helix(ctx, '/clips', { id });
    const clip = data.data?.[0];
    if (!clip) throw new ApiError(404, 'not_found', 'That clip was not found.');
    return { body: { item: clean(clip) }, ttl: 3600 };
  },

  /** This week's top clips from the most-watched game. */
  async trending(_params, ctx) {
    const games = await helix(ctx, '/games/top', { first: 1 });
    const gameId = games.data?.[0]?.id;
    const items = gameId ? await clipsFor(ctx, { game_id: gameId }, 7, 12) : [];
    return { body: { items }, ttl: 1800 };
  },
};
