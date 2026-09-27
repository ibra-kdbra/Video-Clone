/**
 * Shared helpers for the API function: responses, validation and text cleanup.
 */

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * A cacheable JSON response. Browsers keep it for up to 5 minutes; Netlify's CDN keeps it for
 * `ttl` seconds (and serves it stale while refreshing), so repeat visits don't spend API quota.
 */
export const json = (body, ttl) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${Math.min(ttl, 300)}`,
      'Netlify-CDN-Cache-Control': `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 24}`,
      'Netlify-Vary': 'query',
      'X-Content-Type-Options': 'nosniff',
    },
  });

/** An error response. Never cached, so a passing failure isn't served to everyone. */
export const fail = (status, code, message) =>
  new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });

/** Formats of the ids and tokens the API accepts. */
export const PATTERNS = {
  videoId: /^[A-Za-z0-9_-]{11}$/,
  channelId: /^UC[A-Za-z0-9_-]{22}$/,
  pageToken: /^[A-Za-z0-9_-]{1,100}$/,
  clipId: /^[A-Za-z0-9_-]{1,100}$/,
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

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

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
