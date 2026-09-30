import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The auth client (src/lib/session.js) against a fake API: fetch is mocked, and storage is an
 * in-memory stand-in that records every write, so the tests can check what ends up stored.
 */

const USER = { id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace', emailVerified: false, createdAt: '2026-09-01T00:00:00.000Z' };
const authSession = (token) => ({ accessToken: token, expiresIn: 900, user: USER });
const json = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const failure = (status, code, message = 'Nope.', extra = {}) => json(status, { error: { code, message, requestId: 'req-1', ...extra } });
const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

let writes;

/**
 * A fresh copy of the module with stubbed browser globals. `routes` answers requests by
 * "METHOD /path" (after /api/v1), and gets the request's bearer token.
 */
async function setup({ flag = false, locks = null, routes = {} } = {}) {
  vi.resetModules();
  writes = [];
  const store = (name, entries = []) => {
    const map = new Map(entries);
    return {
      map,
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => {
        writes.push({ name, key, value: String(value) });
        map.set(key, String(value));
      },
      removeItem: (key) => map.delete(key),
    };
  };
  const local = store('localStorage', flag ? [['grand.signedIn', '1']] : []);
  const session = store('sessionStorage');
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('navigator', locks ? { locks } : {});

  const calls = [];
  const fetchMock = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^\/api\/v1/, '');
    const bearer = init.headers?.Authorization?.replace(/^Bearer /, '') ?? null;
    const route = `${init.method ?? 'GET'} ${path}`;
    calls.push({ route, bearer, init });
    const answer = routes[route];
    if (!answer) return failure(404, 'not_found');
    return answer({ bearer, body: init.body ? JSON.parse(init.body) : undefined });
  });
  vi.stubGlobal('fetch', fetchMock);

  const lib = await import('../src/lib/session.js');
  const count = (route) => calls.filter((call) => call.route === route).length;
  return { lib, calls, count, local, session };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signing in', () => {
  it('keeps the access token in memory only and sends it with API calls', async () => {
    const { lib, calls, local, session } = await setup({
      routes: {
        'POST /auth/login': () => json(200, authSession('token-one')),
        'GET /auth/me': ({ bearer }) => (bearer === 'token-one' ? json(200, { user: USER, schools: [] }) : failure(401, 'unauthenticated')),
      },
    });

    expect(lib.getSession().status).toBe('signedOut');
    const user = await lib.signIn({ email: 'ada@example.com', password: 'correct horse' });
    expect(user.name).toBe('Ada Lovelace');
    expect(lib.getSession()).toMatchObject({ status: 'signedIn', user: USER });

    await expect(lib.apiFetch('/auth/me')).resolves.toMatchObject({ schools: [] });
    expect(calls.at(-1).bearer).toBe('token-one');

    // Storage only ever holds the "maybe signed in" flag, never the token.
    expect(local.map.get('grand.signedIn')).toBe('1');
    expect(writes.every((write) => !write.value.includes('token-one'))).toBe(true);
    expect([...local.map.values(), ...session.map.values()].join()).not.toContain('token-one');
  });

  it('sends no token to public endpoints', async () => {
    const { lib, calls } = await setup({
      routes: {
        'POST /auth/login': () => json(200, authSession('token-one')),
        'GET /schools/riverside/public': () => json(200, { id: 's1', slug: 'riverside', name: 'Riverside', createdAt: '2026-09-01T00:00:00Z' }),
      },
    });
    await lib.signIn({ email: 'ada@example.com', password: 'correct horse' });
    await lib.apiFetch('/schools/riverside/public', { auth: false });
    expect(calls.at(-1).bearer).toBeNull();
  });
});

describe('refreshing an expired token', () => {
  it('refreshes once when two calls find the token expired at the same time', async () => {
    const { lib, count, calls } = await setup({
      routes: {
        'POST /auth/login': () => json(200, authSession('old')),
        'POST /auth/refresh': () => later(10, json(200, authSession('new'))),
        'GET /auth/me': ({ bearer }) => (bearer === 'new' ? json(200, { user: USER, schools: [] }) : failure(401, 'session_expired')),
        'GET /auth/sessions': ({ bearer }) => (bearer === 'new' ? json(200, []) : failure(401, 'session_expired')),
      },
    });
    await lib.signIn({ email: 'ada@example.com', password: 'correct horse' });

    const [me, devices] = await Promise.all([lib.apiFetch('/auth/me'), lib.apiFetch('/auth/sessions')]);
    expect(me.user.id).toBe('u1');
    expect(devices).toEqual([]);
    expect(count('POST /auth/refresh')).toBe(1);
    // Each call went out twice: with the old token, then once more with the new one.
    expect(calls.filter((call) => call.route === 'GET /auth/me').map((call) => call.bearer)).toEqual(['old', 'new']);
  });

  it('retries a call once after session_expired, and no more', async () => {
    const { lib, count } = await setup({
      routes: {
        'POST /auth/login': () => json(200, authSession('old')),
        'POST /auth/refresh': () => json(200, authSession('new')),
        'GET /schools/riverside': () => failure(401, 'session_expired'),
      },
    });
    await lib.signIn({ email: 'ada@example.com', password: 'correct horse' });

    await expect(lib.apiFetch('/schools/riverside')).rejects.toMatchObject({ status: 401, code: 'session_expired' });
    expect(count('GET /schools/riverside')).toBe(2);
    expect(count('POST /auth/refresh')).toBe(1);
  });

  it('does not refresh for other errors', async () => {
    const { lib, count } = await setup({
      routes: {
        'POST /auth/login': () => json(200, authSession('old')),
        'GET /schools/riverside': () => failure(403, 'forbidden', "You're not a member of this school."),
      },
    });
    await lib.signIn({ email: 'ada@example.com', password: 'correct horse' });
    await expect(lib.apiFetch('/schools/riverside')).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(count('POST /auth/refresh')).toBe(0);
    expect(lib.getSession().status).toBe('signedIn');
  });

  it('signs out when the refresh is refused', async () => {
    const { lib, local } = await setup({
      routes: {
        'POST /auth/login': () => json(200, authSession('old')),
        'POST /auth/refresh': () => failure(401, 'session_expired', 'Please sign in.'),
        'GET /auth/me': () => failure(401, 'session_expired'),
      },
    });
    await lib.signIn({ email: 'ada@example.com', password: 'correct horse' });

    await expect(lib.apiFetch('/auth/me')).rejects.toMatchObject({ code: 'session_expired' });
    expect(lib.getSession()).toMatchObject({ status: 'signedOut', user: null, reason: 'expired' });
    expect(local.map.has('grand.signedIn')).toBe(false);
  });

  it('stays signed in through a network failure while refreshing', async () => {
    const { lib, local } = await setup({
      routes: {
        'POST /auth/login': () => json(200, authSession('old')),
        'POST /auth/refresh': () => Promise.reject(new TypeError('Failed to fetch')),
        'GET /auth/me': () => failure(401, 'session_expired'),
      },
    });
    await lib.signIn({ email: 'ada@example.com', password: 'correct horse' });
    await expect(lib.apiFetch('/auth/me')).rejects.toMatchObject({ status: 0, code: 'network' });
    expect(lib.getSession().status).toBe('signedIn');
    expect(local.map.get('grand.signedIn')).toBe('1');
  });

  it('takes the shared lock around refreshes, so tabs never refresh at once', async () => {
    const request = vi.fn((_name, task) => task());
    const { lib } = await setup({
      locks: { request },
      flag: true,
      routes: { 'POST /auth/refresh': () => json(200, authSession('new')) },
    });
    await lib.restoreSession();
    expect(request).toHaveBeenCalledWith('grand-refresh', expect.any(Function));
    expect(lib.getSession().status).toBe('signedIn');
  });
});

describe('restoring a session on start-up', () => {
  it("doesn't ask the server when this browser hasn't signed in", async () => {
    const { lib, calls } = await setup();
    expect(lib.getSession().status).toBe('signedOut');
    await expect(lib.restoreSession()).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('restores through the refresh cookie when the flag is set, and holds calls until then', async () => {
    const { lib, calls, count } = await setup({
      flag: true,
      routes: {
        'POST /auth/refresh': () => later(10, json(200, authSession('restored'))),
        'GET /auth/me': ({ bearer }) => (bearer === 'restored' ? json(200, { user: USER, schools: [] }) : failure(401, 'unauthenticated')),
      },
    });
    expect(lib.getSession().status).toBe('loading');
    const restoring = lib.restoreSession();
    lib.restoreSession();
    const me = lib.apiFetch('/auth/me');
    await restoring;
    await expect(me).resolves.toMatchObject({ user: USER });
    expect(lib.getSession().status).toBe('signedIn');
    expect(count('POST /auth/refresh')).toBe(1);
    expect(calls.at(-1).bearer).toBe('restored');
  });

  it('forgets the flag when the cookie is no longer valid', async () => {
    const { lib, local } = await setup({ flag: true, routes: { 'POST /auth/refresh': () => failure(401, 'session_expired', 'Please sign in.') } });
    await lib.restoreSession();
    expect(lib.getSession()).toMatchObject({ status: 'signedOut', reason: null });
    expect(local.map.has('grand.signedIn')).toBe(false);
  });

  it('keeps the flag when the server is out of reach, to try again later', async () => {
    const { lib, local } = await setup({ flag: true, routes: { 'POST /auth/refresh': () => json(502, undefined) } });
    await lib.restoreSession();
    expect(lib.getSession().status).toBe('signedOut');
    expect(local.map.get('grand.signedIn')).toBe('1');
  });
});

describe('signing out', () => {
  it('signs out here even when the server is out of reach', async () => {
    const { lib, local, count } = await setup({
      routes: {
        'POST /auth/login': () => json(200, authSession('token-one')),
        'POST /auth/logout': () => Promise.reject(new TypeError('Failed to fetch')),
        'GET /auth/me': ({ bearer }) => (bearer ? json(200, {}) : failure(401, 'unauthenticated', 'Sign in to continue.')),
      },
    });
    await lib.signIn({ email: 'ada@example.com', password: 'correct horse' });
    await lib.signOut();
    expect(count('POST /auth/logout')).toBe(1);
    expect(lib.getSession()).toMatchObject({ status: 'signedOut', reason: 'signout' });
    expect(local.map.has('grand.signedIn')).toBe(false);
    // The old token is gone too.
    await expect(lib.apiFetch('/auth/me')).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it("doesn't let a refresh that was already under way sign the person back in", async () => {
    const { lib } = await setup({
      routes: {
        'POST /auth/login': () => json(200, authSession('old')),
        'POST /auth/refresh': () => later(20, json(200, authSession('late'))),
        'POST /auth/logout': () => json(204),
      },
    });
    await lib.signIn({ email: 'ada@example.com', password: 'correct horse' });
    const refresh = lib.refreshSession().catch((error) => error);
    await lib.signOut();
    await refresh;
    expect(lib.getSession().status).toBe('signedOut');
  });

  it('follows the server when it ends this session', async () => {
    const { lib } = await setup({ routes: { 'POST /auth/login': () => json(200, authSession('token-one')) } });
    await lib.signIn({ email: 'ada@example.com', password: 'correct horse' });
    lib.endSessionLocally('revoked');
    expect(lib.getSession()).toMatchObject({ status: 'signedOut', reason: 'revoked' });
  });
});

describe('errors', () => {
  it("carry the server's code, message and field details", async () => {
    const { lib } = await setup({
      routes: {
        'POST /auth/signup': () =>
          failure(400, 'validation_failed', 'Check the highlighted fields.', { details: [{ path: 'password', message: 'Use at least 10 characters' }, { path: 1 }] }),
      },
    });
    const error = await lib.signUp({ email: 'ada@example.com', password: 'short', name: 'Ada' }).catch((caught) => caught);
    expect(error).toMatchObject({ name: 'ApiError', status: 400, code: 'validation_failed', message: 'Check the highlighted fields.', requestId: 'req-1' });
    expect(error.details).toEqual([{ path: 'password', message: 'Use at least 10 characters' }]);
    expect(lib.getSession().status).toBe('signedOut');
  });

  it('read Retry-After on rate limits', async () => {
    const { lib } = await setup({
      routes: { 'POST /auth/login': () => json(429, { error: { code: 'rate_limited', message: 'Too many attempts.' } }, { 'Retry-After': '120' }) },
    });
    await expect(lib.signIn({})).rejects.toMatchObject({ status: 429, code: 'rate_limited', message: 'Too many attempts.', retryAfter: 120 });
  });

  it('say so plainly when offline, or when the answer is not the API', async () => {
    const { lib } = await setup({
      routes: {
        'GET /schools/a/public': () => Promise.reject(new TypeError('Failed to fetch')),
        'GET /schools/b/public': () => new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      },
    });
    await expect(lib.apiFetch('/schools/a/public', { auth: false })).rejects.toMatchObject({ status: 0, code: 'network' });
    await expect(lib.apiFetch('/schools/b/public', { auth: false })).rejects.toMatchObject({ message: expect.stringMatching(/unavailable/) });
  });
});
