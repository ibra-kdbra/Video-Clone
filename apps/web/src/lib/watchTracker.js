import { PROGRESS_SEGMENT_SECONDS } from '@grand/contracts';

/** The most stretches one report may carry (the API's limit). */
export const MAX_SEGMENTS_PER_REPORT = 720;

/**
 * Which stretches of a video have really played, for the watch progress the player reports. A
 * video is cut into stretches of PROGRESS_SEGMENT_SECONDS (stretch n covers seconds 5n to 5n+5).
 *
 * The player passes every `timeupdate` to `observe(time, { at, playing, rate })`. The time between
 * two of them counts as watched only when the playhead moved forward about as far as the clock
 * did (at the playback speed): that's playing. A jump (scrubbing, skipping ahead, a seek while
 * paused) moves the playhead much further than the clock, so it marks nothing, and `jump()` (on
 * `seeking`) starts afresh from wherever the playhead lands. A background tab that hears fewer
 * updates still counts, since the clock moved as far.
 *
 * `take()` hands over the stretches marked since the last report (and forgets them); `restore()`
 * puts them back when sending failed. Pure: no timers, no DOM, so it's tested on its own.
 */
export function createWatchTracker({ segmentSeconds = PROGRESS_SEGMENT_SECONDS, slack = 1 } = {}) {
  let last = null;
  const pending = new Set();

  const mark = (from, to) => {
    const first = Math.floor(from / segmentSeconds);
    // `to` belongs to the next stretch only once the playhead is actually inside it.
    const end = Math.max(first, Math.ceil(to / segmentSeconds) - 1);
    for (let segment = first; segment <= end; segment++) pending.add(segment);
  };

  return {
    /**
     * A `timeupdate`: the playhead is at `time` seconds, at `at` milliseconds on a steady clock,
     * playing (or paused) at `rate`.
     */
    observe(time, { at = Date.now(), playing = true, rate = 1 } = {}) {
      if (!Number.isFinite(time) || time < 0) return;
      if (last && (last.playing || playing)) {
        const moved = time - last.time;
        const elapsed = Math.max(0, (at - last.at) / 1000);
        const speed = Number.isFinite(rate) && rate > 0 ? rate : 1;
        if (moved > 0 && moved <= elapsed * speed * 1.25 + slack) mark(last.time, time);
      }
      last = { time, at, playing };
    },

    /** The playhead was moved on purpose: whatever comes next doesn't continue from here. */
    jump() {
      last = null;
    },

    /** The stretches marked since the last call, in order, at most `limit` (the rest wait). */
    take(limit = MAX_SEGMENTS_PER_REPORT) {
      const segments = [...pending].sort((a, b) => a - b).slice(0, limit);
      for (const segment of segments) pending.delete(segment);
      return segments;
    },

    /** Puts back stretches that couldn't be sent, for the next report. */
    restore(segments) {
      for (const segment of segments) pending.add(segment);
    },

    get pending() {
      return pending.size;
    },
  };
}

/**
 * Where to pick a lesson's video up again: the saved position, unless it's too close to the start
 * to matter (5 s or less) or so close to the end that there'd be nothing left to see (10 s).
 */
export function resumeAt(positionSeconds, durationSeconds) {
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 5) return 0;
  if (Number.isFinite(durationSeconds) && durationSeconds > 0 && positionSeconds >= durationSeconds - 10) return 0;
  return positionSeconds;
}
