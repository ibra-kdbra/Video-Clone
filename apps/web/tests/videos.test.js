import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api.js', () => ({ apiGet: vi.fn(async (path, params) => ({ item: { path, params } })) }));

const { getVideo } = await import('../src/lib/videos.js');

describe('getVideo', () => {
  it("asks the video proxy for a lesson video's details: a video, or a Twitch clip", async () => {
    expect(await getVideo('youtube', 'dQw4w9WgXcQ')).toEqual({ path: 'youtube/video', params: { id: 'dQw4w9WgXcQ' } });
    expect(await getVideo('dailymotion', 'x8abc12')).toEqual({ path: 'dailymotion/video', params: { id: 'x8abc12' } });
    expect(await getVideo('twitch', 'MockClip0')).toEqual({ path: 'twitch/clip', params: { id: 'MockClip0' } });
  });
});
