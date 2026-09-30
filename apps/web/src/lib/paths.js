/**
 * A `?next=` return path, when it's safe to follow: an address on this site only. "//host" and
 * "/\host" are other sites to a browser, and browsers drop tabs and newlines from addresses, so
 * "/\t/host" would become "//host"; anything like that falls back. So do the sign-in pages
 * themselves, which would send a signed-in visitor round in circles.
 */
export function safeNext(value, fallback = '/') {
  if (typeof value !== 'string' || value.length > 2000) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  const path = value.split(/[?#]/)[0];
  if (/^\/(signin|signup)\/?$/.test(path)) return fallback;
  return value;
}

/** The sign-in (or sign-up) page's address, coming back to `next` afterwards. */
export function authPath(page, next) {
  const back = safeNext(next, '/');
  return back === '/' ? `/${page}` : `/${page}?next=${encodeURIComponent(back)}`;
}
