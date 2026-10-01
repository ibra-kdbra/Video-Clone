import { ApiError } from './api.js';

/**
 * Signing in, and every call to the Grand LMS API (`/api/v1` on this origin).
 *
 * - The access token (a JWT that lasts 15 minutes) lives in this module's memory only, never in
 *   storage, where any script that ever ran on the page could read it back.
 * - The refresh token is an httpOnly cookie this code never sees. The server rotates it on every
 *   refresh and ends the whole session when an old one comes back, so refreshes must never
 *   overlap: one at a time per tab (single flight), and one at a time across tabs (Web Locks).
 * - `grand.signedIn` in localStorage only says "there may be a session to restore", so visitors
 *   who never signed in don't send a refresh request on every visit. It holds nothing secret.
 */

const BASE = '/api/v1';
const FLAG = 'grand.signedIn';
const LOCK = 'grand-refresh';
const OFFLINE = 'You appear to be offline. Check your connection and try again.';
const UNAVAILABLE = 'Grand LMS is unavailable right now. Please try again in a moment.';

let token = null;
let expiresAt = 0;
// Bumped whenever a session starts or ends here, so a refresh that was already on its way can't
// undo it (sign someone back in after they signed out, or out after they signed in).
let epoch = 0;
let refreshing = null;
let restoring = null;

function readFlag() {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

function writeFlag(on) {
  try {
    if (on) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {
    // Storage blocked: the session still works in this tab, it just won't survive a reload.
  }
}

/**
 * `status` is 'loading' while a saved session is being restored, then 'signedIn' or 'signedOut'.
 * `reason` says why a session ended ('signout', 'expired', 'revoked', 'reuse_detected', 'logout'
 * or 'elsewhere'), so the app can say so when it wasn't the person's own doing.
 */
let state = { status: readFlag() ? 'loading' : 'signedOut', user: null, reason: null };
const listeners = new Set();

function setState(next) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export const getSession = () => state;

export function subscribeSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** One request, as is. Resolves with the parsed JSON (null for 204), or throws an ApiError. */
async function send(path, { method = 'GET', body, signal, bearer } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError(0, 'network', OFFLINE);
  }

  if (response.status === 204) {
    // Read the (empty) body anyway, so the browser counts the request as finished, not cancelled.
    await response.arrayBuffer().catch(() => {});
    return null;
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Handled below: an empty or non-JSON answer (a proxy's error page) counts as an outage.
  }
  if (response.ok && data !== null) return data;
  throw toApiError(response, data);
}

/** The API's error body (`{ error: { code, message, details, requestId } }`) as an ApiError. */
function toApiError(response, data) {
  const error = data?.error;
  const retryAfter = Number(response.headers.get('Retry-After')) || null;
  if (!error || typeof error.code !== 'string') {
    return new ApiError(response.status, response.status >= 500 ? 'unavailable' : 'unknown', UNAVAILABLE, { retryAfter });
  }
  const details = Array.isArray(error.details)
    ? error.details.filter((detail) => typeof detail?.path === 'string' && typeof detail?.message === 'string')
    : [];
  return new ApiError(response.status, error.code, typeof error.message === 'string' && error.message ? error.message : UNAVAILABLE, {
    details,
    requestId: typeof error.requestId === 'string' ? error.requestId : null,
    retryAfter,
  });
}

function adopt(session) {
  if (typeof session?.accessToken !== 'string' || !session.user) throw new ApiError(0, 'unavailable', UNAVAILABLE);
  epoch += 1;
  token = session.accessToken;
  // Treated as expired a little early, so a request never leaves with a token that lapses on the way.
  expiresAt = Date.now() + Math.max(0, Number(session.expiresIn) - 30) * 1000;
  writeFlag(true);
  setState({ status: 'signedIn', user: session.user, reason: null });
  return session.user;
}

function endLocally(reason) {
  epoch += 1;
  token = null;
  expiresAt = 0;
  writeFlag(false);
  if (state.status !== 'signedOut') setState({ status: 'signedOut', user: null, reason });
}

/** Runs `task` while holding the refresh lock shared by this site's tabs, where there are Web Locks. */
function withRefreshLock(task) {
  const locks = globalThis.navigator?.locks;
  return typeof locks?.request === 'function' ? locks.request(LOCK, task) : task();
}

/**
 * Trades the refresh cookie for a new access token. Concurrent callers share one request, and tabs
 * take turns. A refused cookie (401/403) ends the session here too; an outage doesn't, so a
 * passing network hiccup never signs anyone out.
 */
export function refreshSession() {
  if (refreshing) return refreshing;
  const started = epoch;
  refreshing = withRefreshLock(() => send('/auth/refresh', { method: 'POST' }))
    .then(
      (session) => {
        if (started !== epoch) throw new ApiError(401, 'session_expired', 'Please sign in.');
        return adopt(session);
      },
      (error) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          if (started === epoch) endLocally(state.status === 'signedIn' ? 'expired' : null);
        } else if (state.status === 'loading') {
          // The server couldn't be reached while restoring: carry on signed out, but keep the flag
          // so the next visit (or coming back online) tries again.
          setState({ status: 'signedOut' });
        }
        throw error;
      },
    )
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * Picks up the session from an earlier visit (or from another tab) through the refresh cookie.
 * It only asks the server when the flag says there may be a session. Never rejects.
 */
export function restoreSession() {
  if (state.status === 'signedIn') return Promise.resolve(state.user);
  if (!readFlag()) {
    if (state.status === 'loading') setState({ status: 'signedOut' });
    return Promise.resolve(null);
  }
  if (!restoring) {
    if (state.status !== 'loading') setState({ status: 'loading', reason: null });
    restoring = refreshSession()
      .catch(() => null)
      .finally(() => {
        restoring = null;
      });
  }
  return restoring;
}

/**
 * Calls the Grand LMS API, e.g. `apiFetch('/schools', { method: 'POST', body })`. Signed-in calls
 * carry the access token; when the server answers that it has expired (or was revoked), the token
 * is refreshed once and the call retried. Throws ApiError with the server's code, message and
 * field details. `auth: false` sends no token (public endpoints).
 */
export async function apiFetch(path, { method = 'GET', body, signal, auth = true } = {}) {
  if (!auth) return send(path, { method, body, signal });
  // Calls made while the session is being restored wait for it, so they go out signed in.
  if (restoring) await restoring;
  if (token && Date.now() >= expiresAt) await refreshSession().catch(() => {});

  const used = token;
  try {
    return await send(path, { method, body, signal, bearer: used });
  } catch (error) {
    if (!used || !(error instanceof ApiError) || error.status !== 401 || error.code !== 'session_expired') throw error;
    // Another call may have refreshed while this one was out; only refresh when none has.
    if (token === used) await refreshSession();
    if (!token) throw error;
    return send(path, { method, body, signal, bearer: token });
  }
}

/**
 * A signed-in call that outlives the page (fetch `keepalive`), for the last word as a tab is hidden
 * or closed (the player's watch progress). It goes with the current access token as is, since
 * there's no time to refresh one. While the page is still there it resolves like apiFetch; when
 * there's no usable token it rejects at once, so the caller can keep what it meant to send.
 */
export async function apiFetchKeepalive(path, { method = 'POST', body } = {}) {
  if (!token || Date.now() >= expiresAt) throw new ApiError(401, 'session_expired', 'Please sign in.');
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      keepalive: true,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, 'network', OFFLINE);
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    // As in send().
  }
  if (response.ok && data !== null) return data;
  throw toApiError(response, data);
}

// Sign-in goes through the same lock as refreshes, so its new cookie can't be overwritten by a
// refresh that was already on its way.
export const signIn = async (credentials) => adopt(await withRefreshLock(() => send('/auth/login', { method: 'POST', body: credentials })));

export const signUp = async (details) => adopt(await withRefreshLock(() => send('/auth/signup', { method: 'POST', body: details })));

/**
 * Signs out here at once, then ends the session on the server, which clears the cookie. Should the
 * server be out of reach, the flag is already gone, so this browser won't restore the session.
 */
export async function signOut() {
  endLocally('signout');
  try {
    await withRefreshLock(() => send('/auth/logout', { method: 'POST' }));
  } catch {
    // Signed out here either way.
  }
}

/** The server ended this session (it says so over the real-time connection): sign out here too. */
export function endSessionLocally(reason) {
  if (state.status !== 'signedOut') endLocally(reason);
}

if (typeof window !== 'undefined') {
  // Another tab signed in or out: follow it.
  window.addEventListener('storage', (event) => {
    if (event.key !== FLAG && event.key !== null) return;
    if (readFlag()) restoreSession();
    else endSessionLocally('elsewhere');
  });
  window.addEventListener('online', () => {
    if (state.status === 'signedOut' && readFlag()) restoreSession();
  });
}
