/**
 * The security headers for every page, kept in one place: `npm run build` writes them to
 * dist/_headers for Netlify, `vite preview` serves them locally, and tests/security.test.mjs checks
 * them. The Content-Security-Policy lets the page run only its own code (plus the one inline theme
 * script in index.html, by hash), call only its own API (and the real-time server, when it lives on
 * another origin, and the LiveKit server for live classes in the browser), load lesson videos and
 * posters from the video store, show images from the video platforms' image servers, and frame
 * their players. The Permissions-Policy lets the page itself (only) use the camera, microphone
 * and screen sharing, for live classes.
 */

/** Hash of the inline theme script in index.html. The security test prints the new one if it drifts. */
export const THEME_SCRIPT_HASH = 'sha256-x6Urb8iOTDG5B29AZwBEiDbh4pzI+3HsEn0U3u4zAGQ=';

const IMAGE_HOSTS = [
  'https://*.ytimg.com',
  'https://yt3.ggpht.com',
  'https://yt3.googleusercontent.com',
  'https://*.dmcdn.net',
  'https://static-cdn.jtvnw.net',
  'https://clips-media-assets2.twitch.tv',
];

const PLAYER_HOSTS = [
  'https://www.youtube-nocookie.com',
  'https://www.dailymotion.com',
  'https://geo.dailymotion.com',
  'https://clips.twitch.tv',
];

/** The video store's origin (https, or http on localhost), or null when there is none. */
export function mediaOrigin(origin) {
  if (!origin) return null;
  const url = new URL(origin);
  if (url.origin !== origin.replace(/\/$/, '')) throw new Error(`MEDIA_ORIGIN must be a bare origin, got "${origin}"`);
  if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return url.origin;
  throw new Error(`MEDIA_ORIGIN must use https (or http on localhost), got "${origin}"`);
}

/**
 * The WebSocket origin of the real-time server, from its https:// (or, locally, http://) origin.
 * Returns null when the real-time server shares the page's origin, since 'self' already covers it.
 */
export function websocketOrigin(realtimeOrigin) {
  if (!realtimeOrigin) return null;
  const url = new URL(realtimeOrigin);
  if (url.origin !== realtimeOrigin.replace(/\/$/, '')) throw new Error(`REALTIME_ORIGIN must be a bare origin, got "${realtimeOrigin}"`);
  if (url.protocol === 'https:') return `wss://${url.host}`;
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return `ws://${url.host}`;
  throw new Error(`REALTIME_ORIGIN must use https (or http on localhost), got "${realtimeOrigin}"`);
}

/**
 * The LiveKit server's origins for connect-src, from LIVEKIT_ORIGIN: a bare wss:// origin (ws:// on
 * localhost), plus its https:// (http://) twin, since livekit-client also checks /rtc/validate over
 * HTTP when a connection fails. Null when there's no LiveKit server. The WebRTC media itself isn't
 * governed by the CSP.
 */
export function livekitOrigins(origin) {
  if (!origin) return null;
  const url = new URL(origin);
  if (`${url.protocol}//${url.host}` !== origin.replace(/\/$/, '') || url.username || url.password) {
    throw new Error(`LIVEKIT_ORIGIN must be a bare origin, got "${origin}"`);
  }
  if (url.protocol === 'wss:') return [`wss://${url.host}`, `https://${url.host}`];
  if (url.protocol === 'ws:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return [`ws://${url.host}`, `http://${url.host}`];
  throw new Error(`LIVEKIT_ORIGIN must use wss:// (or ws:// on localhost), got "${origin}"`);
}

export function contentSecurityPolicy({ realtimeOrigin, mediaOrigin: media, livekitOrigin, https = true } = {}) {
  const socket = websocketOrigin(realtimeOrigin);
  const store = mediaOrigin(media);
  const livekit = livekitOrigins(livekitOrigin) ?? [];
  const only = (...sources) => sources.filter(Boolean).join(' ');
  const directives = [
    "default-src 'self'",
    `script-src 'self' '${THEME_SCRIPT_HASH}'`,
    "style-src 'self'",
    `img-src ${only("'self'", 'data:', store, ...IMAGE_HOSTS)}`,
    "font-src 'self'",
    // The player fetches signed video segments from the store; posters and thumbnails come from there too.
    // Live classes in the browser connect to the LiveKit server.
    `connect-src ${only("'self'", socket, ...livekit, store)}`,
    `frame-src ${PLAYER_HOSTS.join(' ')}`,
    // blob: is the stream hls.js builds from those segments (Media Source Extensions).
    `media-src ${only("'self'", 'blob:', store)}`,
    "manifest-src 'self'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
  ];
  if (https) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** Headers for every page. Leave `https` off only for plain-http local previews. */
export function securityHeaders({ realtimeOrigin, mediaOrigin: media, livekitOrigin, https = true } = {}) {
  return {
    'Content-Security-Policy': contentSecurityPolicy({ realtimeOrigin, mediaOrigin: media, livekitOrigin, https }),
    ...(https && { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // The camera, microphone and screen are for live classes, on this site only (not in the embedded players).
    'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}
