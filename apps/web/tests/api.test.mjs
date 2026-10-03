import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeEntities, safeUrl, text } from '../server/api/http.mjs';
import { handle } from '../server/api/router.mjs';
import { resetTwitchToken } from '../server/api/twitch.mjs';

const ENV = { YOUTUBE_API_KEY: 'test-google-key', TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: 'secret' };
const YT = 'dQw4w9WgXcQ';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A stand-in for the YouTube, Dailymotion and Twitch APIs: one video each, as they describe it. */
function mockFetch(input) {
  const url = new URL(String(input));
  if (url.hostname === 'id.twitch.tv') return Promise.resolve(json({ access_token: 'mock-token', expires_in: 3600 }));
  if (url.hostname === 'api.twitch.tv') {
    const id = url.searchParams.get('id');
    if (url.pathname !== '/helix/clips' || id !== 'MockClip0') return Promise.resolve(json({ data: [] }));
    return Promise.resolve(json({ data: [{ id, title: 'Live coding highlight', thumbnail_url: 'https://static-cdn.jtvnw.net/clip-480.jpg', duration: 28.5, view_count: 9 }] }));
  }
  if (url.hostname === 'api.dailymotion.com') {
    if (url.pathname !== '/video/x8abc12') return Promise.resolve(json({ error: { code: 404 } }, 404));
    return Promise.resolve(
      json({
        id: 'x8abc12',
        title: 'Café sounds',
        thumbnail_360_url: 'https://s1.dmcdn.net/360.jpg',
        thumbnail_480_url: 'https://s1.dmcdn.net/480.jpg',
        thumbnail_720_url: 'https://s1.dmcdn.net/720.jpg',
        duration: 754,
      }),
    );
  }
  const id = url.searchParams.get('id');
  if (url.pathname !== '/youtube/v3/videos' || id !== YT) return Promise.resolve(json({ items: [] }));
  const thumb = (size, width) => ({ url: `https://i.ytimg.com/vi/${id}/${size}.jpg`, width, height: Math.round((width * 9) / 16) });
  return Promise.resolve(
    json({
      items: [
        {
          id,
          // Escaped, like the real YouTube API returns titles.
          snippet: {
            title: 'Nor&#39;easter &amp; sound waves',
            thumbnails: { default: thumb('default', 120), medium: thumb('mqdefault', 320), high: thumb('hqdefault', 480), maxres: thumb('maxresdefault', 1280) },
          },
          contentDetails: { duration: 'PT1H2M5S' },
        },
      ],
    }),
  );
}

const get = (path, env = ENV, fetchImpl = mockFetch, init = {}, options = {}) =>
  handle(new Request(`http://localhost/api/${path}`, init), env, fetchImpl, options);

/** A fetch that records what it was asked and answers from the mock. */
function recorder(answer = mockFetch) {
  const calls = [];
  const fetchImpl = vi.fn((input, init) => {
    calls.push({ url: new URL(String(input)), init });
    return answer(input, init);
  });
  return { calls, fetchImpl };
}

afterEach(() => resetTwitchToken());

describe('routing and request checks', () => {
  it('answers only the video details endpoints', async () => {
    for (const path of ['youtube/search?q=x', 'youtube/trending', `youtube/comments?id=${YT}`, 'twitch/related?id=MockClip0', '../../etc/passwd', 'constructor', 'youtube/__proto__'])
      expect((await get(path)).status, path).toBe(404);
  });

  it('accepts GET only', async () => {
    expect((await get(`youtube/video?id=${YT}`, ENV, mockFetch, { method: 'POST' })).status).toBe(405);
  });

  it('refuses requests sent from other websites before spending any quota', async () => {
    const { calls, fetchImpl } = recorder();
    const response = await get(`youtube/video?id=${YT}`, ENV, fetchImpl, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect((await get(`youtube/video?id=${YT}`, ENV, mockFetch, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
  });

  it('rejects unknown and repeated parameters, so they cannot be used to bypass the cache', async () => {
    const { calls, fetchImpl } = recorder();
    expect((await get(`youtube/video?id=${YT}&cachebust=1`, ENV, fetchImpl)).status).toBe(400);
    expect((await get(`youtube/video?id=${YT}&id=${YT}`, ENV, fetchImpl)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('caches in the CDN for an hour, keyed on the id only', async () => {
    const response = await get(`youtube/video?id=${YT}`);
    expect(response.headers.get('Netlify-Vary')).toBe('query=id');
    const cdn = response.headers.get('Netlify-CDN-Cache-Control');
    expect(cdn).toContain('durable');
    expect(cdn).toContain('max-age=3600');
  });
});

describe('validation', () => {
  it.each(['youtube/video', 'youtube/video?id=short', 'youtube/video?id=../../../x', 'dailymotion/video?id=../x', 'dailymotion/video?id=12345', 'twitch/clip?id=a%20b'])(
    '%s → 400',
    async (path) => {
      const response = await get(path);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('bad_request');
    },
  );
});

describe('keys stay on the server', () => {
  it('sends the Google key to Google only, and never back to the browser', async () => {
    const { calls, fetchImpl } = recorder();
    const body = await (await get(`youtube/video?id=${YT}`, ENV, fetchImpl)).text();
    expect(calls.every((c) => c.url.hostname === 'www.googleapis.com' && c.url.searchParams.get('key') === 'test-google-key')).toBe(true);
    expect(body).not.toContain('test-google-key');
  });

  it('explains a missing key instead of failing silently', async () => {
    const response = await get(`youtube/video?id=${YT}`, {});
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('not_configured');
  });
});

describe('the video shape', () => {
  it.each([`youtube/video?id=${YT}`, 'dailymotion/video?id=x8abc12', 'twitch/clip?id=MockClip0'])('%s has just what a lesson shows', async (path) => {
    const { item } = await (await get(path)).json();
    expect(Object.keys(item).sort()).toEqual(['duration', 'id', 'provider', 'thumbnail', 'thumbnails', 'title']);
    expect(typeof item.title).toBe('string');
    expect(Number.isInteger(item.duration)).toBe(true);
    const widths = item.thumbnails.map((t) => t.width);
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
  });

  it('drops URLs the browser should not load, and HTML from the title', async () => {
    const hostile = {
      items: [
        {
          id: YT,
          snippet: {
            title: '<img src=x onerror=alert(1)>Hello',
            thumbnails: { high: { url: 'javascript:alert(1)', width: 480 }, medium: { url: 'http://insecure.example/x.jpg', width: 320 } },
          },
          contentDetails: { duration: 'PT1M' },
        },
      ],
    };
    const { item } = await (await get(`youtube/video?id=${YT}`, ENV, () => Promise.resolve(json(hostile)))).json();
    expect(item.title).toBe('Hello');
    expect(item.thumbnail).toBeNull();
    expect(item.thumbnails).toEqual([]);
  });
});

describe('YouTube', () => {
  it('returns the decoded title, the length in seconds and the picture sizes, for 1 unit', async () => {
    const { calls, fetchImpl } = recorder();
    const { item } = await (await get(`youtube/video?id=${YT}`, ENV, fetchImpl)).json();
    expect(item).toMatchObject({ provider: 'youtube', id: YT, title: "Nor'easter & sound waves", duration: 3725 });
    expect(item.thumbnail).toBe(`https://i.ytimg.com/vi/${YT}/hqdefault.jpg`);
    expect(item.thumbnails.map((t) => t.width)).toEqual([320, 480, 1280]);
    expect(calls.map((c) => c.url.pathname)).toEqual(['/youtube/v3/videos']);
  });

  it('says when the video is not there', async () => {
    const response = await get('youtube/video?id=aaaaaaaaaaa');
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('not_found');
  });

  it('turns a used-up quota into a clear 429 that is never cached', async () => {
    const quota = () => Promise.resolve(json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403));
    const response = await get(`youtube/video?id=${YT}`, ENV, quota);
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe('quota');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('gives up on a provider that does not answer in time', async () => {
    const hang = (_input, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    const response = await get(`youtube/video?id=${YT}`, ENV, hang, {}, { timeout: 20 });
    expect(response.status).toBe(504);
    expect((await response.json()).error).toBe('timeout');
  });
});

describe('Dailymotion (no key needed)', () => {
  it('returns the title, the length and the pictures by width', async () => {
    const { calls, fetchImpl } = recorder();
    const { item } = await (await get('dailymotion/video?id=x8abc12', {}, fetchImpl)).json();
    expect(calls[0].url.hostname).toBe('api.dailymotion.com');
    expect(item).toMatchObject({ provider: 'dailymotion', id: 'x8abc12', title: 'Café sounds', duration: 754, thumbnail: 'https://s1.dmcdn.net/720.jpg' });
    expect(item.thumbnails.map((t) => t.width)).toEqual([640, 853, 1280]);
  });

  it('says when the video is not there', async () => {
    expect((await get('dailymotion/video?id=x9zzz', {})).status).toBe(404);
  });
});

describe('Twitch', () => {
  it('gets an app token once and reuses it', async () => {
    const { calls, fetchImpl } = recorder();
    await get('twitch/clip?id=MockClip0', ENV, fetchImpl);
    await get('twitch/clip?id=MockClip0', ENV, fetchImpl);
    expect(calls.filter((c) => c.url.hostname === 'id.twitch.tv')).toHaveLength(1);
    const helix = calls.find((c) => c.url.hostname === 'api.twitch.tv');
    expect(helix.init.headers.Authorization).toBe('Bearer mock-token');
    expect(helix.init.headers['Client-Id']).toBe('id');
  });

  it('returns a clip in the shared shape', async () => {
    const { item } = await (await get('twitch/clip?id=MockClip0')).json();
    expect(item).toMatchObject({ provider: 'twitch', id: 'MockClip0', duration: 29, thumbnails: [{ url: 'https://static-cdn.jtvnw.net/clip-480.jpg', width: 480 }] });
  });

  it('says when the clip is not there', async () => {
    expect((await get('twitch/clip?id=Gone')).status).toBe(404);
  });

  it('is optional: without credentials it says so', async () => {
    expect((await get('twitch/clip?id=MockClip0', { YOUTUBE_API_KEY: 'k' })).status).toBe(503);
  });
});

describe('text helpers', () => {
  it.each([
    ['Nor&#39;easter', "Nor'easter"],
    ['Tom &amp; Jerry', 'Tom & Jerry'],
    ['&quot;quoted&quot;', '"quoted"'],
    ['&lt;b&gt;', '<b>'],
    ['&#x1F600; smile', '😀 smile'],
    ['plain text', 'plain text'],
    ['&unknown; stays', '&unknown; stays'],
  ])('decodeEntities(%s) → %s', (input, output) => expect(decodeEntities(input)).toBe(output));

  it('decodeEntities handles missing values', () => {
    expect(decodeEntities(undefined)).toBe('');
    expect(decodeEntities(null)).toBe('');
  });

  it('text() drops tags but keeps line breaks, and caps length', () => {
    expect(text('<p>Hi<br>there</p><script>x</script>')).toBe('Hi\nthere' + 'x');
    expect(text('a'.repeat(20), 10)).toHaveLength(10);
  });

  it.each([
    ['https://i.ytimg.com/vi/x/hq.jpg', 'https://i.ytimg.com/vi/x/hq.jpg'],
    ['/thumb/x.svg', null],
    ['//evil.example/x.jpg', null],
    ['http://i.ytimg.com/x.jpg', null],
    ['javascript:alert(1)', null],
    ['data:image/svg+xml,<svg/>', null],
    ['', null],
  ])('safeUrl(%s) → %s', (input, output) => expect(safeUrl(input)).toBe(output));
});
