import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api.js', () => ({ apiGet: vi.fn() }));

const { apiGet } = await import('../src/lib/api.js');
const { normalizeQuery, searchVideos, trendingVideos } = await import('../src/lib/videos.js');

const failure = (code) => Object.assign(new Error(code), { code });
const v = (provider, id) => ({ provider, id, title: `${provider} ${id}` });

/** Answers `/api/<source>/…` per source: a list of videos, or an error code to fail with. */
function answer(bySource) {
  apiGet.mockImplementation(async (path) => {
    const reply = bySource[path.split('/')[0]];
    if (typeof reply === 'string') throw failure(reply);
    return { items: reply ?? [] };
  });
}

// Braces matter: a function returned from beforeEach runs as a cleanup, and mockReset returns the mock.
beforeEach(() => {
  apiGet.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('normalizeQuery', () => {
  it('lower-cases, trims and collapses spaces, so equal searches share one cache entry', () => {
    expect(normalizeQuery('  React   Hooks ')).toBe('react hooks');
    expect(normalizeQuery('x'.repeat(150))).toHaveLength(100);
  });
});

describe('mixing sources', () => {
  it('interleaves the platforms', async () => {
    answer({ youtube: [v('youtube', 1), v('youtube', 2)], dailymotion: [v('dailymotion', 1)] });
    const { videos, notice } = await trendingVideos(['youtube', 'dailymotion']);
    expect(videos.map((x) => `${x.provider}${x.id}`)).toEqual(['youtube1', 'dailymotion1', 'youtube2']);
    expect(notice).toBeNull();
  });

  it('sends the normalized query', async () => {
    answer({ youtube: [] });
    await searchVideos('  Lo-Fi  Beats', ['youtube']);
    expect(apiGet).toHaveBeenCalledWith('youtube/search', { q: 'lo-fi beats' });
  });

  it.each(['quota', 'not_configured'])('falls back to Dailymotion when YouTube is unavailable (%s)', async (code) => {
    answer({ youtube: code, dailymotion: [v('dailymotion', 1)] });
    const { videos, notice } = await searchVideos('coding', ['youtube']);
    expect(videos.map((x) => x.provider)).toEqual(['dailymotion']);
    expect(notice).toMatch(/other platforms/);
  });

  it('does not ask Dailymotion twice when it is already on', async () => {
    answer({ youtube: 'quota', dailymotion: [v('dailymotion', 1)] });
    await searchVideos('coding', ['youtube', 'dailymotion']);
    expect(apiGet.mock.calls.filter(([path]) => path.startsWith('dailymotion'))).toHaveLength(1);
  });

  it('treats Twitch without credentials as simply empty', async () => {
    answer({ youtube: [v('youtube', 1)], twitch: 'not_configured' });
    const { videos, notice } = await trendingVideos(['youtube', 'twitch']);
    expect(videos).toHaveLength(1);
    expect(notice).toBeNull();
  });

  it('reports the error when there is nothing at all to show', async () => {
    answer({ youtube: 'upstream_error', dailymotion: [] });
    await expect(searchVideos('coding', ['youtube', 'dailymotion'])).rejects.toMatchObject({ code: 'upstream_error' });
  });
});
