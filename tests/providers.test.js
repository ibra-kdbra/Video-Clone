import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/api.js', () => ({ apiGet: vi.fn() }));

const { apiGet } = await import('../src/services/api.js');
const { multiSearch } = await import('../src/services/providers/index.js');

const apiError = (code) => Object.assign(new Error(code), { code });
const youtubeItem = (id) => ({ id: { videoId: id }, snippet: { title: `yt ${id}` } });

/** Dailymotion is called straight from the browser; answer it with `list`. */
function dailymotion(list) {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ list }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

// Braces matter: a function returned from beforeEach runs as a cleanup, and mockReset returns the mock.
beforeEach(() => {
  apiGet.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('multiSearch', () => {
  it('asks for a normalized query, so "React" and "react " share one cached search', async () => {
    apiGet.mockResolvedValue({ items: [] });
    dailymotion([]);
    await multiSearch('  React   Hooks ', ['youtube']);
    expect(apiGet).toHaveBeenCalledWith('youtube/search', { q: 'react hooks' });
  });

  it('shows YouTube results without touching Dailymotion when YouTube answers', async () => {
    apiGet.mockResolvedValue({ items: [youtubeItem('aaaaaaaaaaa')] });
    const fetch = dailymotion([{ id: 'x1' }]);
    const { videos, notice } = await multiSearch('coding', ['youtube']);
    expect(videos.map((v) => v.provider)).toEqual(['youtube']);
    expect(notice).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['quota', 'not_configured'])('falls back to Dailymotion when YouTube is unavailable (%s)', async (code) => {
    apiGet.mockRejectedValue(apiError(code));
    dailymotion([{ id: 'x1', title: 'dm video' }]);
    const { videos, notice } = await multiSearch('coding', ['youtube']);
    expect(videos.map((v) => v.provider)).toEqual(['dailymotion']);
    expect(notice).toMatch(/other platforms/);
  });

  it('does not search Dailymotion twice when it is already switched on', async () => {
    apiGet.mockRejectedValue(apiError('quota'));
    const fetch = dailymotion([{ id: 'x1' }]);
    const { videos } = await multiSearch('coding', ['youtube', 'dailymotion']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(videos).toHaveLength(1);
  });

  it('still reports the error when there is nothing to show at all', async () => {
    apiGet.mockRejectedValue(apiError('quota'));
    dailymotion([]);
    await expect(multiSearch('coding', ['youtube'])).rejects.toMatchObject({ code: 'quota' });
  });
});
