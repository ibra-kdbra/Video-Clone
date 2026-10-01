import { loginInput, signupInput, uuid } from '@grand/contracts';

import { HttpError, notFound, unauthenticated } from '../http.js';
import { hash128, randomId, randomToken } from '../ids.js';
import { iso } from '../logic.js';

/**
 * Accounts and sign-in (apps/api/src/auth). The refresh cookie the real API sets is the demo's
 * saved state: `meta.cookie` holds this browser's refresh token, rotated on every refresh, so a
 * session survives reloads the same way. Access tokens are JWT-shaped and last 15 minutes.
 */

const ACCESS_TTL_SECONDS = 900;

export const toUser = (row) => ({ id: row.id, email: row.email, name: row.name, emailVerified: Boolean(row.emailVerified), createdAt: iso(row.createdAt) });

export const toPublicSchool = (row) => ({ id: row.id, slug: row.slug, name: row.name, createdAt: iso(row.createdAt) });

/** Every school the person belongs to, with their role, oldest membership first. */
export const mySchools = (db, userId) =>
  db
    .filter('memberships', (row) => row.userId === userId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((membership) => ({ ...toPublicSchool(db.get('schools', membership.schoolId)), role: membership.role }));

const invalidCredentials = () => new HttpError(401, 'invalid_credentials', "That email and password don't match an account.");
const sessionEnded = () => new HttpError(401, 'session_expired', 'Your session has ended. Please sign in again.');

const encode = (value) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (text) => JSON.parse(atob(text.replace(/-/g, '+').replace(/_/g, '/')));

/** Passwords of accounts made in the demo are kept hashed with a salt, never as typed. */
export const passwordHash = (password, salt) => `${salt}.${hash128(`${salt}:${password}`)}`;
const checkPassword = (password, stored) => typeof stored === 'string' && passwordHash(password, stored.split('.')[0]) === stored;

export function signAccess(server, { userId, sessionId }) {
  const payload = encode({ sub: userId, sid: sessionId, exp: Math.floor(server.now() / 1000) + ACCESS_TTL_SECONDS });
  const head = encode({ alg: 'HS256', typ: 'JWT' });
  return `${head}.${payload}.${hash128(`${server.secret()}.${head}.${payload}`)}`;
}

/** The AuthGuard: the signed-in person, `null` without a token, or the API's refusal for a bad one. */
export function verifyAccess(server, header) {
  if (!header) return null;
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header)?.[1];
  if (!token) throw unauthenticated();
  const [head, payload, signature] = token.split('.');
  if (signature !== hash128(`${server.secret()}.${head}.${payload}`)) throw unauthenticated();
  let claims;
  try {
    claims = decode(payload);
  } catch {
    throw unauthenticated();
  }
  const session = server.db.get('sessions', claims.sid);
  if (claims.exp * 1000 <= server.now() || !session || session.revokedAt) throw new HttpError(401, 'session_expired', 'Your session has expired.');
  return { userId: claims.sub, sessionId: claims.sid };
}

/** Starts a session for this browser: the "cookie" now holds its refresh token. */
function issue(server, user, client) {
  const now = server.now();
  const session = server.db.put('sessions', {
    id: randomId(),
    userId: user.id,
    userAgent: client.userAgent,
    createdAt: now,
    lastUsedAt: now,
    revokedAt: null,
    refreshToken: randomToken(),
  });
  server.setCookie({ token: session.refreshToken, sessionId: session.id });
  return { accessToken: signAccess(server, { userId: user.id, sessionId: session.id }), expiresIn: ACCESS_TTL_SECONDS, user: toUser(user) };
}

export function register(router, server) {
  router.add('POST', '/auth/signup', { public: true, body: signupInput, status: 201 }, (ctx) => {
    const { db } = ctx;
    if (db.find('users', (row) => row.email === ctx.body.email)) throw new HttpError(409, 'email_taken', 'An account with this email already exists. Sign in instead.');
    const salt = randomToken(9);
    const user = db.put('users', {
      id: randomId(),
      key: null,
      email: ctx.body.email,
      name: ctx.body.name,
      password: passwordHash(ctx.body.password, salt),
      persona: false,
      emailVerified: false,
      notificationSettings: {},
      createdAt: ctx.now,
    });
    // In the demo, a new account joins the demo school as a student, so there's something to explore.
    const school = server.demoSchool();
    if (school) db.put('memberships', { id: `${school.id}:${user.id}`, schoolId: school.id, userId: user.id, role: 'student', createdAt: ctx.now });
    return issue(server, user, ctx.client);
  });

  router.add('POST', '/auth/login', { public: true, body: loginInput, status: 200 }, (ctx) => {
    const user = ctx.db.find('users', (row) => row.email === ctx.body.email);
    const valid = user && (user.persona ? ctx.body.password === server.password : checkPassword(ctx.body.password, user.password));
    if (!valid) throw invalidCredentials();
    const session = issue(server, user, ctx.client);
    server.signedIn(user.id);
    return session;
  });

  router.add('POST', '/auth/refresh', { public: true, status: 200 }, (ctx) => {
    const cookie = server.cookie();
    if (!cookie) throw new HttpError(401, 'session_expired', 'Please sign in.');
    const session = ctx.db.get('sessions', cookie.sessionId);
    const user = session && ctx.db.get('users', session.userId);
    if (!session || session.revokedAt || session.refreshToken !== cookie.token || !user) {
      server.setCookie(null);
      throw sessionEnded();
    }
    const token = randomToken();
    ctx.db.update('sessions', session.id, { refreshToken: token, lastUsedAt: ctx.now });
    server.setCookie({ token, sessionId: session.id });
    server.signedIn(user.id);
    return { accessToken: signAccess(server, { userId: user.id, sessionId: session.id }), expiresIn: ACCESS_TTL_SECONDS, user: toUser(user) };
  });

  router.add('POST', '/auth/logout', { public: true }, (ctx) => {
    const cookie = server.cookie();
    if (cookie && ctx.db.get('sessions', cookie.sessionId)) ctx.db.update('sessions', cookie.sessionId, { revokedAt: ctx.now, refreshToken: null });
    server.setCookie(null);
  });

  router.add('GET', '/auth/me', {}, (ctx) => {
    const user = ctx.db.get('users', ctx.auth.userId);
    if (!user) throw unauthenticated();
    return { user: toUser(user), schools: mySchools(ctx.db, user.id) };
  });

  router.add('GET', '/auth/sessions', {}, (ctx) =>
    ctx.db
      .filter('sessions', (row) => row.userId === ctx.auth.userId && !row.revokedAt)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .map((row) => ({ id: row.id, userAgent: row.userAgent, createdAt: iso(row.createdAt), lastUsedAt: iso(row.lastUsedAt), current: row.id === ctx.auth.sessionId })),
  );

  router.add('DELETE', '/auth/sessions/:sessionId', { params: { sessionId: uuid } }, (ctx) => {
    const session = ctx.db.get('sessions', ctx.params.sessionId);
    if (!session || session.userId !== ctx.auth.userId || session.revokedAt) throw notFound('This session');
    ctx.db.update('sessions', session.id, { revokedAt: ctx.now, refreshToken: null });
  });

  router.add('POST', '/realtime/ticket', { status: 201 }, () => ({ ticket: randomToken(), expiresIn: 30 }));
}
