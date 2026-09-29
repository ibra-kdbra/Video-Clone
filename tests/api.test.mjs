import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeEntities, safeUrl, text } from '../server/api/http.mjs';
import { handle } from '../server/api/router.mjs';
import { resetTwitchToken } from '../server/api/twitch.mjs';
import { CHANNELS, mockFetch } from './mocks/upstream.mjs';

const ENV = { YOUTUBE_API_KEY: 'test-google-key', TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: 'secret' };
const CHANNEL = CHANNELS[0][0];
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

/** A fetch that answers one upstream path with `body` and everything else from the mock. */
const replying = (match, body, status = 200) => (input, init) =>
  String(input).includes(match) ? Promise.resolve(new Response(JSON.stringify(body), { status })) : mockFetch(input, init);

afterEach(() => resetTwitchToken());

describe('routing and request checks', () => {
  it('answers only the listed endpoints', async () => {
    expect((await get('youtube/anything?q=x')).status).toBe(404);
    expect((await get('../../etc/passwd')).status).toBe(404);
    expect((await get('constructor')).status).toBe(404);
    expect((await get('youtube/__proto__')).status).toBe(404);
  });

  it('accepts GET only', async () => {
    expect((await get('youtube/search?q=x', ENV, mockFetch, { method: 'POST' })).status).toBe(405);
  });

  it('refuses requests sent from other websites before spending any quota', async () => {
    const { calls, fetchImpl } = recorder();
    const response = await get('youtube/search?q=x', ENV, fetchImpl, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect((await get('youtube/search?q=x', ENV, mockFetch, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200);
  });

  it('rejects unknown and repeated parameters, so they cannot be used to bypass the cache', async () => {
    const { calls, fetchImpl } = recorder();
    expect((await get('youtube/search?q=x&cachebust=1', ENV, fetchImpl)).status).toBe(400);
    expect((await get('youtube/search?q=x&q=y', ENV, fetchImpl)).status).toBe(400);
    expect((await get('youtube/trending?q=x', ENV, fetchImpl)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('keys the CDN cache on the parameters the endpoint reads', async () => {
    expect((await get('youtube/search?q=x')).headers.get('Netlify-Vary')).toBe('query=q');
    expect((await get(`youtube/channel-videos?id=${CHANNEL}`)).headers.get('Netlify-Vary')).toBe('query=id|pageToken');
  });
});

describe('validation', () => {
  it.each([
    ['youtube/search', 400],
    ['youtube/search?q=' + 'a'.repeat(101), 400],
    ['youtube/video?id=short', 400],
    ['youtube/video?id=../../../x', 400],
    ['youtube/channel?id=not-a-channel', 400],
    ['youtube/channel-videos?id=' + CHANNEL + '&pageToken=%3Cscript%3E', 400],
    ['dailymotion/video?id=../x', 400],
    ['dailymotion/video?id=12345', 400],
    ['twitch/clip?id=a%20b', 400],
  ])('%s → %i', async (path, status) => {
    const response = await get(path);
    expect(response.status).toBe(status);
    expect((await response.json()).error).toBe('bad_request');
  });
});

describe('keys stay on the server', () => {
  it('sends the Google key to Google only, and never back to the browser', async () => {
    const { calls, fetchImpl } = recorder();
    const text = await (await get('youtube/search?q=react', ENV, fetchImpl)).text();
    expect(calls.every((c) => c.url.hostname === 'www.googleapis.com' && c.url.searchParams.get('key') === 'test-google-key')).toBe(true);
    expect(text).not.toContain('test-google-key');
  });

  it('explains a missing key instead of failing silently', async () => {
    const response = await get('youtube/search?q=react', {});
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('not_configured');
  });
});

describe('the shared video shape', () => {
  it.each(['youtube/search?q=coding', 'dailymotion/search?q=coding', 'twitch/search?q=coding'])('%s', async (path) => {
    const { items } = await (await get(path)).json();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        ['channel', 'description', 'duration', 'id', 'likes', 'live', 'provider', 'publishedAt', 'thumbnail', 'thumbnails', 'title', 'views'].sort(),
      );
      expect(typeof item.title).toBe('string');
      expect(item.duration === null || Number.isInteger(item.duration)).toBe(true);
      expect(item.views === null || typeof item.views === 'number').toBe(true);
    }
  });

  it('drops URLs the browser should not load, and HTML from text', async () => {
    const hostile = {
      items: [
        {
          id: 'aaaaaaaaaaa',
          snippet: {
            title: '<img src=x onerror=alert(1)>Hello',
            channelTitle: 'Chan',
            thumbnails: { high: { url: 'javascript:alert(1)', width: 480 }, medium: { url: 'http://insecure.example/x.jpg', width: 320 } },
          },
          contentDetails: { duration: 'PT1M' },
          statistics: {},
        },
      ],
    };
    const { item } = await (await get('youtube/video?id=aaaaaaaaaaa', ENV, replying('/videos', hostile))).json();
    expect(item.title).toBe('Hello');
    expect(item.thumbnail).toBeNull();
    expect(item.thumbnails).toEqual([]);
  });
});

describe('YouTube', () => {
  it('search returns durations in seconds, view counts and decoded titles, cached for a day', async () => {
    const response = await get('youtube/search?q=Coding');
    const { items } = await response.json();
    expect(items).toHaveLength(24);
    expect(items[0].provider).toBe('youtube');
    expect(items[0].duration).toBeGreaterThan(0);
    expect(items[0].views).toBeGreaterThan(0);
    expect(items[2].title).toBe("Nor'easter & Coding: what you need to know");
    expect(items[0].thumbnails.map((t) => t.width)).toEqual([320, 480, 640]);
    const cdn = response.headers.get('Netlify-CDN-Cache-Control');
    expect(cdn).toContain('durable');
    expect(cdn).toContain('max-age=86400');
  });

  it('trending uses the 1-unit popular chart, not one of the 100 daily searches', async () => {
    const { calls, fetchImpl } = recorder();
    const { items } = await (await get('youtube/trending', ENV, fetchImpl)).json();
    expect(items).toHaveLength(24);
    expect(calls.map((c) => c.url.pathname)).not.toContain('/youtube/v3/search');
    expect(calls[0].url.searchParams.get('chart')).toBe('mostPopular');
  });

  it('trending falls back to a search when the chart is unavailable', async () => {
    const { calls, fetchImpl } = recorder(replying('chart=mostPopular', { error: { errors: [{ reason: 'invalidChart' }] } }, 400));
    const { items } = await (await get('youtube/trending', ENV, fetchImpl)).json();
    expect(items.length).toBeGreaterThan(0);
    expect(calls.map((c) => c.url.pathname)).toContain('/youtube/v3/search');
  });

  it('video details include the channel avatar and real subscriber count', async () => {
    const { items } = await (await get('youtube/search?q=Coding')).json();
    const { item } = await (await get(`youtube/video?id=${items[0].id}`)).json();
    expect(item.channel.subscribers).toBe(3_400_000);
    expect(item.channel.avatar).toMatch(/^\/__mock\/avatar\//);
  });

  it('channel videos use the 1-unit uploads playlist and can page', async () => {
    const { calls, fetchImpl } = recorder();
    const first = await (await get(`youtube/channel-videos?id=${CHANNEL}`, ENV, fetchImpl)).json();
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.nextPageToken).toBeTruthy();
    expect(calls.map((c) => c.url.pathname)).not.toContain('/youtube/v3/search');
    expect(calls[0].url.searchParams.get('playlistId')).toBe(`UU${CHANNEL.slice(2)}`);
    const second = await (await get(`youtube/channel-videos?id=${CHANNEL}&pageToken=${first.nextPageToken}`)).json();
    expect(second.items[0].id).not.toBe(first.items[0].id);
  });

  it('channel details include the banner, handle and counts', async () => {
    const { item } = await (await get(`youtube/channel?id=${CHANNEL}`)).json();
    expect(item.title).toBe(CHANNELS[0][1]);
    expect(item.handle).toMatch(/^@/);
    expect(item.banner).toBeTruthy();
    expect(item.subscribers).toBe(3_400_000);
  });

  it('related videos leave out the video being watched', async () => {
    const channel = await (await get(`youtube/channel-videos?id=${CHANNEL}`)).json();
    const watching = channel.items[0].id;
    const related = await (await get(`youtube/related?id=${watching}`)).json();
    expect(related.items.map((i) => i.id)).not.toContain(watching);
  });

  it('comments come back as plain text in a small shape', async () => {
    const { calls, fetchImpl } = recorder();
    const body = await (await get('youtube/comments?id=dQw4w9WgXcQ', ENV, fetchImpl)).json();
    expect(calls[0].url.searchParams.get('textFormat')).toBe('plainText');
    expect(body.items).toHaveLength(5);
    expect(Object.keys(body.items[0]).sort()).toEqual(['author', 'avatar', 'id', 'likes', 'publishedAt', 'text']);
  });

  it('turns a used-up quota into a clear 429 that is never cached', async () => {
    const quota = () => Promise.resolve(new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 }));
    const response = await get('youtube/search?q=x', ENV, quota);
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe('quota');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('reports comments turned off as an empty, flagged list', async () => {
    const disabled = () => Promise.resolve(new Response(JSON.stringify({ error: { errors: [{ reason: 'commentsDisabled' }] } }), { status: 403 }));
    expect(await (await get('youtube/comments?id=dQw4w9WgXcQ', ENV, disabled)).json()).toEqual({ items: [], disabled: true });
  });

  it('gives up on a provider that does not answer in time', async () => {
    const hang = (_input, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    const response = await get('youtube/search?q=x', ENV, hang, {}, { timeout: 20 });
    expect(response.status).toBe(504);
    expect((await response.json()).error).toBe('timeout');
  });
});

describe('Dailymotion (no key needed)', () => {
  it('search asks for family-safe results and returns plain-text descriptions', async () => {
    const { calls, fetchImpl } = recorder();
    const { items } = await (await get('dailymotion/search?q=travel', {}, fetchImpl)).json();
    expect(calls[0].url.hostname).toBe('api.dailymotion.com');
    expect(calls[0].url.searchParams.get('family_filter')).toBe('true');
    expect(items[0].provider).toBe('dailymotion');
    expect(items[0].description).not.toMatch(/<[a-z]/i);
    expect(items[0].channel.title).toBeTruthy();
  });

  it('video details and related videos from the same creator', async () => {
    const { items } = await (await get('dailymotion/trending', {})).json();
    const id = items[0].id;
    const { item } = await (await get(`dailymotion/video?id=${id}`, {})).json();
    expect(item.id).toBe(id);
    const related = await (await get(`dailymotion/related?id=${id}`, {})).json();
    expect(related.items.map((i) => i.id)).not.toContain(id);
  });
});

describe('Twitch', () => {
  it('gets an app token once and reuses it', async () => {
    const { calls, fetchImpl } = recorder();
    await get('twitch/search?q=coding', ENV, fetchImpl);
    await get('twitch/trending', ENV, fetchImpl);
    expect(calls.filter((c) => c.url.hostname === 'id.twitch.tv')).toHaveLength(1);
    const helix = calls.find((c) => c.url.hostname === 'api.twitch.tv');
    expect(helix.init.headers.Authorization).toBe('Bearer mock-token');
    expect(helix.init.headers['Client-Id']).toBe('id');
  });

  it('search returns clips in the shared shape', async () => {
    const { items } = await (await get('twitch/search?q=coding')).json();
    expect(items[0]).toMatchObject({ provider: 'twitch', id: 'MockClip0', duration: 29 });
  });

  it('related clips leave out the one being watched', async () => {
    const { items } = await (await get('twitch/related?id=MockClip0')).json();
    expect(items.map((i) => i.id)).not.toContain('MockClip0');
  });

  it('is optional: without credentials it says so', async () => {
    expect((await get('twitch/trending', { YOUTUBE_API_KEY: 'k' })).status).toBe(503);
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
    ['/__mock/thumb/x.svg', '/__mock/thumb/x.svg'],
    ['//evil.example/x.jpg', null],
    ['http://i.ytimg.com/x.jpg', null],
    ['javascript:alert(1)', null],
    ['data:image/svg+xml,<svg/>', null],
    ['', null],
  ])('safeUrl(%s) → %s', (input, output) => expect(safeUrl(input)).toBe(output));
});
