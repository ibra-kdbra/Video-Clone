import { describe, expect, it } from 'vitest';

import { formatCount, formatDuration, formatViews, joinMeta, srcSet, timeAgo } from '../src/lib/format.js';

describe('formatDuration (seconds)', () => {
  it.each([
    [253, '4:13'],
    [3725, '1:02:05'],
    [45, '0:45'],
    [600, '10:00'],
    [28.5, '0:29'],
    [0, ''],
    [null, ''],
    [undefined, ''],
    [Number.NaN, ''],
  ])('%s → %s', (input, output) => expect(formatDuration(input)).toBe(output));
});

describe('counts', () => {
  it.each([
    [3_400_000, '3.4M'],
    [1234, '1.2K'],
    [999, '999'],
    [null, ''],
    ['', ''],
  ])('formatCount(%s) → %s', (input, output) => expect(formatCount(input)).toBe(output));

  it('formatViews reads naturally', () => {
    expect(formatViews(1)).toBe('1 view');
    expect(formatViews(1500)).toBe('1.5K views');
    expect(formatViews(null)).toBe('');
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  it.each([
    ['2026-09-28T11:59:30Z', 'just now'],
    ['2026-09-28T09:00:00Z', '3 hours ago'],
    ['2026-09-27T12:00:00Z', 'yesterday'],
    ['2026-09-14T12:00:00Z', '2 weeks ago'],
    ['2025-09-28T12:00:00Z', 'last year'],
    ['not a date', ''],
    [null, ''],
  ])('%s → %s', (input, output) => expect(timeAgo(input, now)).toBe(output));
});

describe('srcSet and joinMeta', () => {
  it('lists sizes for the browser to choose from', () => {
    expect(srcSet([{ url: 'm.jpg', width: 320 }, { url: 'h.jpg', width: 480 }, { url: '', width: 9 }])).toBe('m.jpg 320w, h.jpg 480w');
    expect(srcSet(undefined)).toBe('');
  });

  it('joins what is known', () => expect(joinMeta('Channel', '', null, '3 days ago')).toBe('Channel · 3 days ago'));
});
