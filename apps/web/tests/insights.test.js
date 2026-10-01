import { describe, expect, it } from 'vitest';

import { describeRetention, retentionSeries, timeTicks } from '../src/lib/insights.js';

describe('retentionSeries', () => {
  it('turns counts per stretch into shares of those who started', () => {
    const series = retentionSeries({ segmentSeconds: 5, viewers: 8, counts: [8, 6, 3] });
    expect(series.duration).toBe(15);
    expect(series.points).toEqual([
      { index: 0, start: 0, end: 5, viewers: 8, percent: 100 },
      { index: 1, start: 5, end: 10, viewers: 6, percent: 75 },
      { index: 2, start: 10, end: 15, viewers: 3, percent: 37.5 },
    ]);
    expect(retentionSeries(null)).toBeNull();
    expect(retentionSeries({ segmentSeconds: 5, viewers: 0, counts: [0, 0] }).points[1].percent).toBe(0);
  });
});

describe('describeRetention', () => {
  const describe_ = (counts, viewers = 10) => describeRetention(retentionSeries({ segmentSeconds: 5, viewers, counts }));

  it('says where most viewers stop', () => {
    // 100% up to 1:15, then down to 40% from 1:20.
    const counts = [...Array(16).fill(10), ...Array(8).fill(4)];
    expect(describe_(counts)).toBe('Most viewers stop around 1:20, where 60% of them leave. 40% reach the end.');
  });

  it('says when most watch to the end, when they leave gradually, or that nobody has watched', () => {
    expect(describe_([10, 10, 9, 9, 8])).toBe('Most viewers watch to the end: 80% reach the end.');
    expect(describe_([10, 10, 9, 8, 7, 6])).toBe('Most viewers watch to the end: 60% reach the end.');
    expect(describe_([10, 9, 8, 7, 6, 5, 4])).toBe('Viewers leave gradually: half have stopped by 0:30. 40% reach the end.');
    expect(describe_([0, 0, 0], 0)).toBe('No one has watched this video yet.');
    expect(describeRetention(null)).toBe('No one has watched this video yet.');
  });
});

describe('timeTicks', () => {
  it.each([
    [24, [0, 5, 10, 15, 20]],
    [60, [0, 10, 20, 30, 40, 50, 60]],
    [125, [0, 30, 60, 90, 120]],
    [600, [0, 120, 240, 360, 480, 600]],
    [0, [0]],
  ])('%s seconds → %j', (duration, ticks) => expect(timeTicks(duration)).toEqual(ticks));
});
