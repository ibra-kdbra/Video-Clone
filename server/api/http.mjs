/**
 * Shared helpers for the API function: responses, validation, upstream calls and text cleanup.
 */

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
};

/**
 * A cacheable JSON response. Browsers keep it for up to 5 minutes. Netlify's CDN keeps it for
 * `ttl` seconds in its durable cache, which all edge locations share, so a response is fetched
 * from YouTube, Dailymotion or Twitch once per `ttl` in total rather than once per location.
 * After that it is served stale while one background request refreshes it. This keeps the free
 * API quotas and Netlify's free-plan function usage low.
 *
 * The cache key only includes the parameters the endpoint reads (`vary`), so adding made-up
 * parameters to a URL can't be used to bypass the cache and spend quota.
 */
export const json = (body, ttl, vary = []) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'Cache-Control': `public, max-age=${Math.min(ttl, 300)}`,
      'Netlify-CDN-Cache-Control': `public, durable, max-age=${ttl}, stale-while-revalidate=${Math.min(ttl * 24, 7 * 86400)}`,
      ...(vary.length && { 'Netlify-Vary': `query=${vary.join('|')}` }),
    },
  });

/** An error response. Never cached, so a passing failure isn't served to everyone. */
export const fail = (status, code, message) =>
  new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { ...BASE_HEADERS, 'Cache-Control': 'no-store' },
  });

/** Formats of the ids and tokens the API accepts. */
export const PATTERNS = {
  videoId: /^[A-Za-z0-9_-]{11}$/,
  channelId: /^UC[A-Za-z0-9_-]{22}$/,
  pageToken: /^[A-Za-z0-9_-]{1,100}$/,
  clipId: /^[A-Za-z0-9_-]{1,100}$/,
  dailymotionId: /^x[A-Za-z0-9]{2,15}$/,
};

/** Reads a required query parameter that must match `pattern`. */
export function need(params, name, pattern) {
  const value = params.get(name)?.trim();
  if (!value || !pattern.test(value)) throw new ApiError(400, 'bad_request', `Missing or invalid "${name}".`);
  return value;
}

/** Reads an optional query parameter; when present it must match `pattern`. */
export function maybe(params, name, pattern) {
  const value = params.get(name)?.trim();
  if (!value) return undefined;
  if (!pattern.test(value)) throw new ApiError(400, 'bad_request', `Invalid "${name}".`);
  return value;
}

/** Reads a search query: required, trimmed, at most `max` characters. */
export function query(params, max = 100) {
  const value = params.get('q')?.replace(/\s+/g, ' ').trim();
  if (!value) throw new ApiError(400, 'bad_request', 'Missing search query "q".');
  if (value.length > max) throw new ApiError(400, 'bad_request', `The search query is longer than ${max} characters.`);
  return value;
}

/** How long an upstream API gets to answer before the request is abandoned. */
export const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * Calls an upstream API with a timeout, so a slow provider can't hold the function (and the
 * visitor) open. Network failures become a 502 and timeouts a 504; the URL is never logged,
 * because it can carry a key.
 */
export async function upstream(ctx, url, init = {}, label = 'upstream') {
  try {
    return await ctx.fetch(url, { ...init, signal: AbortSignal.timeout(ctx.timeout ?? UPSTREAM_TIMEOUT_MS) });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
      throw new ApiError(504, 'timeout', 'The video service took too long to answer. Please try again.');
    console.error(`[api] ${label} request failed: ${error?.message}`);
    throw new ApiError(502, 'upstream_error', 'The video service could not be reached.');
  }
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Decodes HTML entities. The YouTube API escapes titles and descriptions
 * ("Nor&#39;easter"), and React would otherwise show the codes as text.
 */
export function decodeEntities(text) {
  if (typeof text !== 'string' || !text.includes('&')) return text ?? '';
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED[entity.toLowerCase()] ?? match;
  });
}

/**
 * Plain text from an upstream string: entities decoded, any HTML tags dropped (Dailymotion
 * descriptions contain some), and length capped so a response stays small.
 */
export function text(value, max = 5000) {
  if (typeof value !== 'string') return '';
  const plain = decodeEntities(value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''));
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/**
 * A URL the browser may load: absolute https, or a same-origin path (the local mock's
 * thumbnails). Anything else (javascript:, data:, http:) becomes null.
 */
export function safeUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** A count from an upstream string or number, or null when it is missing or hidden. */
export function count(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Seconds from an ISO 8601 duration ("PT1H2M3S"); null when unknown, 0 for live ("P0D"). */
export function isoSeconds(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!match) return null;
  const [, d = 0, h = 0, m = 0, s = 0] = match;
  return Math.round(Number(d) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s));
}
