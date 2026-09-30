import { afterAll, beforeAll, expect, it } from 'vitest';
import { PASSWORD, TestApi, type TestResponse, uniqueEmail } from './helpers.js';

let api: TestApi;
beforeAll(async () => {
  api = await TestApi.start({ RATE_LIMITS: 'true' });
});
afterAll(() => api.close());

it('limits sign-ups per address and says when to retry', async () => {
  const statuses: number[] = [];
  let last: TestResponse | null = null;
  for (let attempt = 0; attempt < 11; attempt++) {
    last = await api.request('POST', '/auth/signup', { body: { email: uniqueEmail(), password: PASSWORD, name: 'Rate' } });
    statuses.push(last.status);
  }
  expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
  expect(statuses[10]).toBe(429);
  expect(last!.body.error.code).toBe('rate_limited');
  expect(Number(last!.headers.get('retry-after'))).toBeGreaterThan(0);
  expect(last!.headers.get('ratelimit-remaining')).toBe('0');
});

it('reports the remaining budget on ordinary requests', async () => {
  const response = await api.request('GET', '/health/live');
  expect(response.headers.get('ratelimit-limit')).toBe('600');
  expect(Number(response.headers.get('ratelimit-remaining'))).toBeLessThan(600);
});

it('counts visitors by the address their proxy reports, when told to trust that header', async () => {
  const proxied = await TestApi.start({ RATE_LIMITS: 'true', CLIENT_IP_HEADER: 'x-nf-client-connection-ip' });
  try {
    const signup = (ip: string) =>
      proxied.request('POST', '/auth/signup', {
        body: { email: uniqueEmail(), password: PASSWORD, name: 'Proxied' },
        headers: { 'x-nf-client-connection-ip': ip },
      });
    for (let attempt = 0; attempt < 10; attempt++) expect((await signup('203.0.113.7')).status).toBe(201);
    expect((await signup('203.0.113.7')).status).toBe(429);
    // Someone else behind the same proxy isn't affected.
    expect((await signup('198.51.100.20')).status).toBe(201);
  } finally {
    await proxied.close();
  }
});
