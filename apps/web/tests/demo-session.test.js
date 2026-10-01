import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The app's own API client (src/lib/session.js) in demo mode, against the real mock API and
 * content: signing in as a persona, picking the session up again after a reload (the saved demo
 * state stands in for the refresh cookie), and signing out.
 */

function browser(entries = new Map()) {
  vi.stubGlobal('localStorage', {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('The demo must not use the network');
    }),
  );
  return entries;
}

async function load(entries) {
  vi.resetModules();
  vi.stubEnv('VITE_DEMO', 'true');
  browser(entries);
  return import('../src/lib/session.js');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('demo sessions', () => {
  it('signs in as a persona, survives a reload, and signs out', async () => {
    const storage = new Map();
    const first = await load(storage);
    const user = await first.signIn({ email: 'amira@grand-academy.demo', password: 'demo' });
    expect(user.name).toBe('Amira Haddad');
    expect(storage.get('grand.signedIn')).toBe('1');
    const me = await first.apiFetch('/auth/me');
    expect(me.schools.map((school) => school.slug)).toEqual(['grand-academy']);
    await expect(first.signIn({ email: 'amira@grand-academy.demo', password: 'wrong' })).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });

    // A reload: the flag says there may be a session, and the saved demo state has its "cookie".
    const second = await load(storage);
    expect(second.getSession().status).toBe('loading');
    await second.restoreSession();
    expect(second.getSession()).toMatchObject({ status: 'signedIn', user: { name: 'Amira Haddad' } });

    await second.signOut();
    expect(storage.get('grand.signedIn')).toBeUndefined();
    const third = await load(storage);
    await third.restoreSession();
    expect(third.getSession().status).toBe('signedOut');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turns API errors into the same ApiErrors as the real API', async () => {
    const session = await load(new Map());
    await session.signIn({ email: 'daniel@grand-academy.demo', password: 'demo' });
    await expect(session.apiFetch('/schools/grand-academy/courses/python-for-beginners/lessons/not-an-id')).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
    // The role check comes before the body's, as on the server.
    const patch = () => session.apiFetch('/schools/grand-academy/members/00000000-0000-8000-8000-000000000000', { method: 'PATCH', body: { role: 'owner' } });
    await expect(patch()).rejects.toMatchObject({ status: 403, code: 'forbidden', message: 'Only a school admin or above can do this.' });
    await session.signOut();
    await session.signIn({ email: 'lena@grand-academy.demo', password: 'demo' });
    await expect(patch()).rejects.toMatchObject({
      status: 400,
      code: 'validation_failed',
      details: [expect.objectContaining({ path: 'role' })],
    });
  });
});
