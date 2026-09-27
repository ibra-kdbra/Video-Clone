import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeEntities } from '../server/api/http.mjs';
import { handle } from '../server/api/router.mjs';
import { resetTwitchToken } from '../server/api/twitch.mjs';
import { mockFetch } from './mocks/upstream.mjs';

const ENV = { YOUTUBE_API_KEY: 'test-google-key', TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: 'secret' };
const get = (path, env = ENV, fetchImpl = mockFetch) => handle(new Request(`http://localhost/api/${path}`), env, fetchImpl);

/** A fetch that records what it was asked and answers from the mock. */
function recorder() {
  const calls = [];
  const fetchImpl = vi.fn((input, init) => {
    calls.push({ url: new URL(String(input)), init });
    return mockFetch(input, init);
  });
  return { calls, fetchImpl };
}

afterEach(() => resetTwitchToken());

describe('routing', () => {
  it('answers only the listed endpoints', async () => {
    expect((await get('youtube/anything?q=x')).status).toBe(404);
    expect((await get('../../etc/passwd')).status).toBe(404);
    expect((await get('constructor')).status).toBe(404);
  });

  it('accepts GET only', async () => {
    const response = await handle(new Request('http://localhost/api/youtube/search?q=x', { method: 'POST' }), ENV, mockFetch);
    expect(response.status).toBe(405);
  });
});

describe('validation', () => {
  it.each([
    ['youtube/search', 400],
    ['youtube/search?q=' + 'a'.repeat(101), 400],
    ['youtube/video?id=short', 400],
    ['youtube/video?id=../../../x', 400],
    ['youtube/channel?id=not-a-channel', 400],
    ['youtube/search?q=ok&pageToken=%3Cscript%3E', 400],
  ])('%s → %i', async (path, status) => {
    const response = await get(path);
    expect(response.status).toBe(status);
    expect((await response.json()).error).toBe('bad_request');
  });
});

describe('keys stay on the server', () => {
  it('sends the Google key to Google only, and never back to the browser', async () => {
    const { calls, fetchImpl } = recorder();
    const response = await get('youtube/search?q=react', ENV, fetchImpl);
    const text = await response.text();
    expect(calls.every((c) => c.url.hostname === 'www.googleapis.com' && c.url.searchParams.get('key') === 'test-google-key')).toBe(true);
    expect(text).not.toContain('test-google-key');
  });

  it('falls back to RapidAPI when only RAPIDAPI_KEY is set', async () => {
    const { calls, fetchImpl } = recorder();
    await get('youtube/search?q=react', { RAPIDAPI_KEY: 'rapid' }, fetchImpl);
    expect(calls[0].url.hostname).toBe('youtube-v31.p.rapidapi.com');
    expect(calls[0].init.headers['X-RapidAPI-Key']).toBe('rapid');
    expect(calls[0].url.searchParams.has('key')).toBe(false);
  });

  it('explains a missing key instead of failing silently', async () => {
    const response = await get('youtube/search?q=react', {});
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('not_configured');
  });
});

describe('YouTube', () => {
  it('search adds durations and statistics, decodes titles, and is cacheable', async () => {
    const response = await get('youtube/search?q=Coding');
    const body = await response.json();
    expect(body.items).toHaveLength(24);
    expect(body.items[0].contentDetails.duration).toMatch(/^PT/);
    expect(body.items[0].statistics.viewCount).toBeDefined();
    expect(body.items[2].snippet.title).toBe("Nor'easter & Coding: what you need to know");
    expect(response.headers.get('Netlify-CDN-Cache-Control')).toContain('s-maxage=3600');
    expect(response.headers.get('Netlify-Vary')).toBe('query');
  });

  it('video details include the channel and its real subscriber count', async () => {
    const search = await (await get('youtube/search?q=Coding')).json();
    const id = search.items[0].id.videoId;
    const { item } = await (await get(`youtube/video?id=${id}`)).json();
    expect(item.channel.subscriberCount).toBe('3400000');
    expect(item.channel.title).toBeTruthy();
  });

  it('channel videos use the 1-unit uploads playlist, not a 100-unit search', async () => {
    const { calls, fetchImpl } = recorder();
    const body = await (await get('youtube/channel-videos?id=UCsBjURrPoezykLs9EqgamOA', ENV, fetchImpl)).json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(calls.map((c) => c.url.pathname)).not.toContain('/youtube/v3/search');
    expect(calls[0].url.searchParams.get('playlistId')).toBe('UUsBjURrPoezykLs9EqgamOA');
  });

  it('related videos leave out the video being watched', async () => {
    const channel = await (await get('youtube/channel-videos?id=UCsBjURrPoezykLs9EqgamOA')).json();
    const watching = channel.items[0].id.videoId;
    const related = await (await get(`youtube/related?id=${watching}`)).json();
    expect(related.items.map((i) => i.id.videoId)).not.toContain(watching);
  });

  it('comments come back as plain text', async () => {
    const { calls, fetchImpl } = recorder();
    const body = await (await get('youtube/comments?id=dQw4w9WgXcQ', ENV, fetchImpl)).json();
    expect(calls[0].url.searchParams.get('textFormat')).toBe('plainText');
    expect(body.items).toHaveLength(5);
  });

  it('turns a used-up quota into a clear 429 that is never cached', async () => {
    const quota = () =>
      Promise.resolve(new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 }));
    const response = await get('youtube/search?q=x', ENV, quota);
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe('quota');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('reports comments turned off as an empty, flagged list', async () => {
    const disabled = () =>
      Promise.resolve(new Response(JSON.stringify({ error: { errors: [{ reason: 'commentsDisabled' }] } }), { status: 403 }));
    const body = await (await get('youtube/comments?id=dQw4w9WgXcQ', ENV, disabled)).json();
    expect(body).toEqual({ items: [], disabled: true });
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

  it('search returns clips with their clip URLs', async () => {
    const body = await (await get('twitch/search?q=coding')).json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0].url).toMatch(/^https:\/\/clips\.twitch\.tv\//);
  });

  it('is optional: without credentials it says so', async () => {
    const response = await get('twitch/trending', { YOUTUBE_API_KEY: 'k' });
    expect(response.status).toBe(503);
  });
});

describe('decodeEntities', () => {
  it.each([
    ['Nor&#39;easter', "Nor'easter"],
    ['Tom &amp; Jerry', 'Tom & Jerry'],
    ['&quot;quoted&quot;', '"quoted"'],
    ['&lt;b&gt;', '<b>'],
    ['&#x1F600; smile', '😀 smile'],
    ['plain text', 'plain text'],
    ['&unknown; stays', '&unknown; stays'],
  ])('%s → %s', (input, output) => expect(decodeEntities(input)).toBe(output));

  it('handles missing values', () => {
    expect(decodeEntities(undefined)).toBe('');
    expect(decodeEntities(null)).toBe('');
  });
});
