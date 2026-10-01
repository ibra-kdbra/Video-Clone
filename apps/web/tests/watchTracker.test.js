import { describe, expect, it } from 'vitest';

import { MAX_SEGMENTS_PER_REPORT, createWatchTracker, resumeAt } from '../src/lib/watchTracker.js';

/** Plays from `from` to `to` seconds in `timeupdate`s every `step` seconds (at `rate`), from clock time `start` (ms). */
function play(tracker, { from, to, step = 0.25, rate = 1, start = 0 }) {
  let at = start;
  for (let time = from; time <= to + 1e-9; time += step * rate) {
    tracker.observe(Math.min(time, to), { at, playing: true, rate });
    at += step * 1000;
  }
  return at;
}

describe('createWatchTracker', () => {
  it('marks every 5-second stretch that plays through, once', () => {
    const tracker = createWatchTracker();
    play(tracker, { from: 0, to: 12 });
    expect(tracker.take()).toEqual([0, 1, 2]);
    expect(tracker.take()).toEqual([]);
  });

  it('counts a stretch only once the playhead is inside it', () => {
    const tracker = createWatchTracker();
    play(tracker, { from: 0, to: 5 });
    expect(tracker.take()).toEqual([0]);
    tracker.observe(5.25, { at: 99_999 + 5250 });
    // Far more clock time than playhead: still forward, and within what playing allows.
    expect(tracker.take()).toEqual([1]);
  });

  it("doesn't count scrubbing or skipping ahead", () => {
    const tracker = createWatchTracker();
    let at = play(tracker, { from: 0, to: 3 });
    // Dragged along the seek bar: big jumps in a few hundred milliseconds.
    for (const time of [20, 40, 60, 80]) {
      tracker.observe(time, { at, playing: true });
      at += 100;
    }
    expect(tracker.take()).toEqual([0]);
    // Playing on from where it landed counts from there.
    play(tracker, { from: 80, to: 86, start: at });
    expect(tracker.take()).toEqual([16, 17]);
  });

  it('starts afresh after a seek, even a small one', () => {
    const tracker = createWatchTracker();
    let at = play(tracker, { from: 0, to: 4 });
    tracker.jump();
    // −5 s, then playing on: the jump back isn't "played", the replay is (already counted once).
    tracker.observe(9, { at, playing: true });
    at += 250;
    play(tracker, { from: 9, to: 11, start: at });
    expect(tracker.take()).toEqual([0, 1, 2]);
  });

  it('ignores time that passes while paused, and seeks made while paused', () => {
    const tracker = createWatchTracker();
    let at = play(tracker, { from: 0, to: 2 });
    tracker.observe(2.1, { at, playing: false });
    at += 60_000;
    // Paused for a minute, then moved to 30 s (no "seeking" seen): nothing played in between.
    tracker.observe(30, { at, playing: false });
    expect(tracker.take()).toEqual([0]);
  });

  it('keeps counting at higher speeds and in a background tab with fewer updates', () => {
    const fast = createWatchTracker();
    play(fast, { from: 0, to: 20, rate: 2 });
    expect(fast.take()).toEqual([0, 1, 2, 3]);

    const background = createWatchTracker();
    background.observe(0, { at: 0 });
    background.observe(14, { at: 14_000 });
    background.observe(29, { at: 29_200 });
    expect(background.take()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('never goes backwards or counts bad values', () => {
    const tracker = createWatchTracker();
    tracker.observe(10, { at: 0 });
    tracker.observe(9, { at: 250 });
    tracker.observe(Number.NaN, { at: 500 });
    tracker.observe(-1, { at: 750 });
    expect(tracker.take()).toEqual([]);
  });

  it('hands over at most a report’s worth, and takes back what failed to send', () => {
    const tracker = createWatchTracker({ segmentSeconds: 1 });
    tracker.observe(0, { at: 0 });
    tracker.observe(1000, { at: 1_000_000 });
    expect(tracker.pending).toBe(1000);
    const first = tracker.take();
    expect(first).toHaveLength(MAX_SEGMENTS_PER_REPORT);
    expect(first[0]).toBe(0);
    expect(tracker.pending).toBe(1000 - MAX_SEGMENTS_PER_REPORT);
    tracker.restore(first.slice(0, 3));
    expect(tracker.take(5)).toEqual([0, 1, 2, 720, 721]);
  });
});

describe('resumeAt', () => {
  it.each([
    [0, 120, 0],
    [5, 120, 0],
    [42.5, 120, 42.5],
    [109, 120, 109],
    [110, 120, 0],
    [118, 120, 0],
    [40, null, 40],
    [Number.NaN, 120, 0],
  ])('position %s of %s → %s', (position, duration, expected) => expect(resumeAt(position, duration)).toBe(expected));
});
