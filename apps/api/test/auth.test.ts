import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, refreshCookie, TestApi, uniqueEmail, WEB_ORIGIN } from './helpers.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start();
});
afterAll(() => api.close());

describe('signup', () => {
  it('creates the account, signs in, and sets an httpOnly refresh cookie scoped to /api/v1/auth', async () => {
    const email = uniqueEmail();
    const response = await api.request('POST', '/auth/signup', { body: { email: `  ${email.toUpperCase()} `, password: PASSWORD, name: 'Ada' } });
    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ email, name: 'Ada', emailVerified: false });
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body.expiresIn).toBe(900);
    const cookie = response.headers.getSetCookie()[0]!;
    expect(cookie).toMatch(/^grand_rt=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('refuses a second account for the same address, whatever its case', async () => {
    const { email } = await api.signup();
    const response = await api.request('POST', '/auth/signup', { body: { email: email.toUpperCase(), password: PASSWORD, name: 'Again' } });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('email_taken');
  });

  it('lists every invalid field at once and rejects unknown ones', async () => {
    const response = await api.request('POST', '/auth/signup', { body: { email: 'nope', password: 'short', name: '', admin: true } });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_failed');
    expect(response.body.error.details.map((detail: { path: string }) => detail.path).sort()).toEqual(['', 'email', 'name', 'password']);
    expect(response.body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('only accepts JSON bodies', async () => {
    const form = await api.request('POST', '/auth/signup', { body: 'email=a', headers: { 'content-type': 'text/plain' } });
    expect(form.status).toBe(415);
    const broken = await api.request('POST', '/auth/signup', { body: '{"email":', headers: { 'content-type': 'application/json' } });
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe('bad_request');
  });
});

describe('login', () => {
  it('signs in with the right password and answers the same way for a wrong password or unknown address', async () => {
    const { email } = await api.signup();
    const ok = await api.request('POST', '/auth/login', { body: { email, password: PASSWORD } });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe(email);

    const wrong = await api.request('POST', '/auth/login', { body: { email, password: 'not the password' } });
    const unknown = await api.request('POST', '/auth/login', { body: { email: uniqueEmail(), password: 'not the password' } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks an address after ten failed attempts, even with the right password', async () => {
    const { email } = await api.signup();
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await api.request('POST', '/auth/login', { body: { email, password: 'wrong password' } })).status).toBe(401);
    }
    const locked = await api.request('POST', '/auth/login', { body: { email, password: PASSWORD } });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('access tokens', () => {
  it('opens /auth/me with the account and its schools', async () => {
    const person = await api.signup('Grace');
    const school = await api.createSchool(person.token);
    const me = await api.request('GET', '/auth/me', { token: person.token });
    expect(me.status).toBe(200);
    expect(me.body.user.name).toBe('Grace');
    expect(me.body.schools).toEqual([expect.objectContaining({ id: school.id, role: 'owner' })]);
  });

  it('refuses missing, malformed, tampered and foreign tokens', async () => {
    const { token } = await api.signup();
    expect((await api.request('GET', '/auth/me')).status).toBe(401);
    expect((await api.request('GET', '/auth/me', { headers: { authorization: 'Basic abc' } })).status).toBe(401);
    const [header, payload, signature] = token.split('.');
    const tampered = `${header}.${payload}.${signature!.slice(0, -2)}AA`;
    expect((await api.request('GET', '/auth/me', { token: tampered })).status).toBe(401);
    const foreign = await new SignJWT({ sid: crypto.randomUUID() })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setSubject(crypto.randomUUID())
      .setIssuer('grand-lms')
      .setAudience('grand-lms:api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('some-other-secret-some-other-secret-some-other'));
    expect((await api.request('GET', '/auth/me', { token: foreign })).status).toBe(401);
  });

  it('says session_expired for an expired token, so the app knows to refresh', async () => {
    const expired = await new SignJWT({ sid: crypto.randomUUID() })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setSubject(crypto.randomUUID())
      .setIssuer('grand-lms')
      .setAudience('grand-lms:api')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode('test-secret-that-is-long-enough-for-hs256-signing-000'));
    const response = await api.request('GET', '/auth/me', { token: expired });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('session_expired');
  });
});

describe('refresh tokens', () => {
  const refresh = (cookie: string, origin: string | null = WEB_ORIGIN) =>
    api.request('POST', '/auth/refresh', { cookie, headers: origin ? { origin } : {} });

  it('rotates the cookie on every refresh', async () => {
    const person = await api.signup();
    const first = await refresh(person.cookie);
    expect(first.status).toBe(200);
    const next = refreshCookie(first.headers);
    expect(next).not.toBe(person.cookie);
    expect((await api.request('GET', '/auth/me', { token: first.body.accessToken })).status).toBe(200);
    expect((await refresh(next)).status).toBe(200);
  });

  it('ends the whole session when a used refresh token comes back (it was copied)', async () => {
    const person = await api.signup();
    const rotated = await refresh(person.cookie);
    const stolen = await refresh(person.cookie);
    expect(stolen.status).toBe(401);
    expect(stolen.body.error.code).toBe('session_expired');
    // The legitimate device is signed out too: its new cookie and its access tokens stop working.
    expect((await refresh(refreshCookie(rotated.headers))).status).toBe(401);
    expect((await api.request('GET', '/auth/me', { token: rotated.body.accessToken })).status).toBe(401);
    expect((await api.request('GET', '/auth/me', { token: person.token })).body.error.code).toBe('session_expired');
  });

  it('lets only one of two simultaneous refreshes with the same token win', async () => {
    const person = await api.signup();
    const results = await Promise.all([refresh(person.cookie), refresh(person.cookie)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
  });

  it('refuses requests that do not come from the web app', async () => {
    const person = await api.signup();
    expect((await refresh(person.cookie, null)).status).toBe(403);
    expect((await refresh(person.cookie, 'https://evil.example')).status).toBe(403);
    expect((await refresh('grand_rt=' + 'x'.repeat(43))).status).toBe(401);
  });

  it('signs out: the cookie is cleared and stops working, as do the access tokens', async () => {
    const person = await api.signup();
    const logout = await api.request('POST', '/auth/logout', { cookie: person.cookie, headers: { origin: WEB_ORIGIN } });
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie()[0]).toMatch(/^grand_rt=;/);
    expect((await refresh(person.cookie)).status).toBe(401);
    expect((await api.request('GET', '/auth/me', { token: person.token })).status).toBe(401);
  });
});

describe('devices', () => {
  it('lists signed-in devices and signs one out', async () => {
    const person = await api.signup();
    const other = await api.request('POST', '/auth/login', { body: { email: person.email, password: PASSWORD }, headers: { 'user-agent': 'Phone' } });
    const sessions = await api.request('GET', '/auth/sessions', { token: person.token });
    expect(sessions.body).toHaveLength(2);
    const phone = sessions.body.find((session: { userAgent: string }) => session.userAgent === 'Phone');
    expect(phone.current).toBe(false);

    expect((await api.request('DELETE', `/auth/sessions/${phone.id}`, { token: person.token })).status).toBe(204);
    expect((await api.request('GET', '/auth/me', { token: other.body.accessToken })).status).toBe(401);
    expect((await api.request('GET', '/auth/me', { token: person.token })).status).toBe(200);
    expect((await api.request('DELETE', `/auth/sessions/${phone.id}`, { token: person.token })).status).toBe(404);
  });

  it("can't sign out someone else's device", async () => {
    const alice = await api.signup();
    const bob = await api.signup();
    const [bobSession] = (await api.request('GET', '/auth/sessions', { token: bob.token })).body;
    expect((await api.request('DELETE', `/auth/sessions/${bobSession.id}`, { token: alice.token })).status).toBe(404);
    expect((await api.request('GET', '/auth/me', { token: bob.token })).status).toBe(200);
  });
});

describe('HTTP basics', () => {
  it('sends security headers, a request id and no-store on API answers', async () => {
    const response = await api.request('GET', '/health/live', { headers: { 'x-request-id': 'trace-12345678' } });
    expect(response.headers.get('x-request-id')).toBe('trace-12345678');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('reports readiness of the database and Redis', async () => {
    const response = await api.request('GET', '/health/ready');
    expect(response.status).toBe(200);
    expect(response.body.info).toMatchObject({ database: { status: 'up' }, redis: { status: 'up' } });
  });

  it('answers unknown routes with the standard error shape', async () => {
    const response = await api.request('GET', '/nope');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });

  it('publishes the OpenAPI document with the request schemas', async () => {
    const response = await api.request('GET', '/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body.paths['/api/v1/auth/signup'].post.requestBody).toBeDefined();
  });
});
