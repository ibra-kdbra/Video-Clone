import { describe, expect, it } from 'vitest';

import { formatBytes, formatClock, formatCount, formatDuration, formatRuntime, formatViews, joinMeta, plural, srcSet, timeAgo } from '../src/lib/format.js';

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

describe('course and player numbers', () => {
  it.each([
    [0, '0:00'],
    [null, '0:00'],
    [5.9, '0:05'],
    [65, '1:05'],
    [3725, '1:02:05'],
  ])('formatClock(%s) → %s', (input, output) => expect(formatClock(input)).toBe(output));

  it.each([
    [0, ''],
    [40, '40 sec'],
    [20.4, '20 sec'],
    [2700, '45 min'],
    [4800, '1 h 20 min'],
    [7200, '2 h'],
  ])('formatRuntime(%s) → %s', (input, output) => expect(formatRuntime(input)).toBe(output));

  it.each([
    [512, '512 B'],
    [1536, '1.5 KB'],
    [734003200, '700 MB'],
    [2 * 1024 ** 3, '2 GB'],
    [10.5 * 1024 ** 3, '11 GB'],
    [-1, ''],
  ])('formatBytes(%s) → %s', (input, output) => expect(formatBytes(input)).toBe(output));

  it('pluralizes', () => {
    expect(plural(1, 'lesson')).toBe('1 lesson');
    expect(plural(3, 'lesson')).toBe('3 lessons');
    expect(plural(0, 'student')).toBe('0 students');
  });
});
