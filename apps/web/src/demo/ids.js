/**
 * Stable identifiers and a seeded random generator for the demo. Everything seeded is derived
 * from the content's keys, so a course, lesson or question has the same id on every visit and
 * after every reset, and addresses like /s/grand-academy/c/…/l/{id} keep working.
 */

/** A 128-bit hash of `text` (cyrb128), as 32 hex characters. Not for security: for ids and seeds. */
export function hash128(text) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

/** 32 hex characters as an RFC 9562 UUID (version 8, "custom"), which the API's schemas accept. */
function asUuid(hex) {
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The same UUID for the same parts, every time: `stableId('lesson', 'linear-algebra', 'vectors')`. */
export const stableId = (...parts) => asUuid(hash128(`grand-demo/${parts.join('/')}`));

/** A fresh random UUID, for things made during the visit. */
export function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  let hex = '';
  for (let i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16);
  return asUuid(hex);
}

/** A random token (base64url), for access and refresh tokens. */
export function randomToken(bytes = 24) {
  const values = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(values);
  else for (let i = 0; i < bytes; i++) values[i] = Math.floor(Math.random() * 256);
  let text = '';
  for (const value of values) text += String.fromCharCode(value);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A seeded random generator (sfc32), so the generated classmates do the same things on every visit.
 * `next()` is in [0, 1); the helpers build on it.
 */
export function createRandom(seed) {
  const hex = hash128(String(seed));
  let a = parseInt(hex.slice(0, 8), 16);
  let b = parseInt(hex.slice(8, 16), 16);
  let c = parseInt(hex.slice(16, 24), 16);
  let d = parseInt(hex.slice(24, 32), 16);
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Warm up, so similar seeds don't start alike.
  for (let i = 0; i < 12; i++) next();
  return {
    next,
    /** An integer from `min` to `max`, both included. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /** A number from `min` to `max`. */
    between: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    /** A few of `list`, in their order. */
    sample(list, count) {
      const chosen = [...list]
        .map((item) => ({ item, at: next() }))
        .sort((x, y) => x.at - y.at)
        .slice(0, count);
      return list.filter((item) => chosen.some((entry) => entry.item === item));
    },
  };
}
