const KEY = 'grand.invite';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

let invalidLink = false;

/**
 * Invitation emails link to /invite#<token>. A fragment never reaches a server, and this moves the
 * token out of the address bar (and so out of history, bookmarks and copied links) before the app
 * even starts. It waits in this tab's sessionStorage, which survives the trip through sign-in or
 * sign-up and is gone when the tab closes.
 */
export function captureInviteToken() {
  const { pathname, search, hash } = window.location;
  if (pathname !== '/invite' || hash.length < 2) return;
  const token = hash.slice(1);
  invalidLink = !TOKEN.test(token);
  try {
    if (invalidLink) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, token);
  } catch {
    // Storage blocked: the invitation page says the link couldn't be read.
  }
  window.history.replaceState(window.history.state, '', `${pathname}${search}`);
}

/** The waiting invitation token, or null; `invalid` when the link that was opened was malformed. */
export function readInvite() {
  try {
    const token = sessionStorage.getItem(KEY);
    return { token: token && TOKEN.test(token) ? token : null, invalid: invalidLink };
  } catch {
    return { token: null, invalid: invalidLink };
  }
}

export function forgetInvite() {
  invalidLink = false;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
