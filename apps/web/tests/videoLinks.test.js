import { describe, expect, it } from 'vitest';

import { parseVideoLink } from '../src/lib/videoLinks.js';

describe('reading a pasted video address', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123', 'youtube', 'dQw4w9WgXcQ'],
    ['youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'youtube', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.dailymotion.com/video/x8abc12', 'dailymotion', 'x8abc12'],
    ['https://www.dailymotion.com/video/x7tgad0_my-great-talk', 'dailymotion', 'x7tgad0'],
    ['https://dai.ly/x8abc12', 'dailymotion', 'x8abc12'],
    ['https://www.dailymotion.com/embed/video/x8abc12', 'dailymotion', 'x8abc12'],
    ['https://geo.dailymotion.com/player.html?video=x8abc12', 'dailymotion', 'x8abc12'],
    ['https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage', 'twitch', 'AwkwardHelplessSalamanderSwiftRage'],
    ['https://clips.twitch.tv/embed?clip=AwkwardHelplessSalamanderSwiftRage&parent=x', 'twitch', 'AwkwardHelplessSalamanderSwiftRage'],
    ['https://www.twitch.tv/somechannel/clip/AwkwardHelplessSalamanderSwiftRage-abc123', 'twitch', 'AwkwardHelplessSalamanderSwiftRage-abc123'],
    ['https://m.twitch.tv/clip/AwkwardHelplessSalamanderSwiftRage', 'twitch', 'AwkwardHelplessSalamanderSwiftRage'],
  ])('%s → %s %s', (input, provider, ref) => expect(parseVideoLink(input)).toEqual({ provider, ref }));

  it('says what is wrong otherwise', () => {
    expect(parseVideoLink('')).toBeNull();
    expect(parseVideoLink('   ')).toBeNull();
    expect(parseVideoLink('https://vimeo.com/123456')).toEqual({ error: expect.stringMatching(/YouTube video, a Dailymotion video or a Twitch clip/) });
    expect(parseVideoLink('https://www.youtube.com/watch?v=short')).toEqual({ error: expect.stringMatching(/YouTube address/) });
    expect(parseVideoLink('https://www.youtube.com/channel/UCabc')).toEqual({ error: expect.stringMatching(/YouTube address/) });
    expect(parseVideoLink('https://www.twitch.tv/videos/123456789')).toEqual({ error: expect.stringMatching(/Only Twitch clips/) });
    expect(parseVideoLink('https://www.dailymotion.com/video/XUPPER')).toEqual({ error: expect.stringMatching(/Dailymotion address/) });
    expect(parseVideoLink('javascript:alert(1)')).toEqual({ error: expect.any(String) });
    expect(parseVideoLink('not a url at all')).toEqual({ error: expect.any(String) });
  });

  it("doesn't take look-alike hosts", () => {
    expect(parseVideoLink('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toHaveProperty('error');
    expect(parseVideoLink('https://notyoutu.be/dQw4w9WgXcQ')).toHaveProperty('error');
  });
});
