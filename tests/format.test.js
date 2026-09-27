import { describe, expect, it } from 'vitest';

import { formatCount, formatDuration, thumbnailSrcSet } from '../src/utils/format.js';
import { normalizeTwitch } from '../src/services/providers/twitchProvider.js';
import { normalizeYouTube } from '../src/services/providers/youtubeProvider.js';

describe('formatDuration', () => {
  it.each([
    ['PT4M13S', '4:13'],
    ['PT1H2M5S', '1:02:05'],
    ['PT45S', '0:45'],
    ['PT10M', '10:00'],
    ['P1DT2H', '26:00:00'],
    ['P0D', 'LIVE'],
    [28.5, '0:29'],
    [3725, '1:02:05'],
    ['', ''],
    [undefined, ''],
    ['nonsense', ''],
    [0, ''],
  ])('%s → %s', (input, output) => expect(formatDuration(input)).toBe(output));
});

describe('formatCount', () => {
  it.each([
    ['3400000', '3.4M'],
    [1234, '1.2K'],
    [999, '999'],
    ['', ''],
    [undefined, ''],
    ['abc', ''],
  ])('%s → %s', (input, output) => expect(formatCount(input)).toBe(output));
});

describe('thumbnailSrcSet', () => {
  it('lists the sizes YouTube provides, smallest first', () => {
    expect(
      thumbnailSrcSet({
        default: { url: 'd.jpg', width: 120 },
        medium: { url: 'm.jpg', width: 320 },
        high: { url: 'h.jpg', width: 480 },
      }),
    ).toBe('m.jpg 320w, h.jpg 480w');
  });

  it('is empty when there are none', () => expect(thumbnailSrcSet(undefined)).toBe(''));
});

describe('providers', () => {
  it('YouTube items get a real duration, or none (never a made-up one)', () => {
    const withDuration = normalizeYouTube({ id: { videoId: 'abc' }, snippet: { title: 't' }, contentDetails: { duration: 'PT3M2S' } });
    const without = normalizeYouTube({ id: { videoId: 'abc' }, snippet: { title: 't' } });
    expect(withDuration.duration).toBe('3:02');
    expect(without.duration).toBe('');
  });

  it('Twitch clips link to clips.twitch.tv and format their seconds', () => {
    const clip = normalizeTwitch({ id: 'Clip1', url: 'https://clips.twitch.tv/Clip1', title: 'x', duration: 30.4, view_count: 5 });
    expect(clip.playerUrl).toBe('https://clips.twitch.tv/Clip1');
    expect(clip.duration).toBe('0:30');
    expect(normalizeTwitch({ id: 'Clip2' }).playerUrl).toBe('https://clips.twitch.tv/Clip2');
  });
});
