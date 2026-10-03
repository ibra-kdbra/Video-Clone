import { ApiError, PATTERNS, need, upstream } from './http.mjs';
import { video } from './video.mjs';

const HELIX = 'https://api.twitch.tv/helix';

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

export const twitch = {
  /** One clip's title, picture (480 px wide) and length. */
  async clip(params, ctx) {
    const id = need(params, 'id', PATTERNS.clipId);
    const data = await helix(ctx, '/clips', { id });
    const clip = data.data?.[0];
    if (!clip) throw new ApiError(404, 'not_found', 'That clip was not found.');
    const item = video({
      provider: 'twitch',
      id: clip.id,
      title: clip.title,
      thumbnail: clip.thumbnail_url,
      thumbnails: [{ url: clip.thumbnail_url, width: 480 }],
      duration: clip.duration,
    });
    return { body: { item }, ttl: 3600 };
  },
};
