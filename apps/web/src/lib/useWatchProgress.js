import { useEffect, useMemo, useRef } from 'react';

import { recordProgress, recordProgressOnExit } from './learning.js';
import { createWatchTracker } from './watchTracker.js';

/** While playing, a report goes about this often. */
const REPORT_EVERY_MS = 10_000;

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Reports what an enrolled student watches of an uploaded video (PUT …/progress): the stretches
 * that really played (see watchTracker.js) and where they are, so the lesson can resume there and
 * completes at 90% watched. A report goes about every 10 seconds while playing, and on pause, at
 * the end, when seeking away, when the tab is hidden and when leaving the page (hidden or closed:
 * with fetch keepalive, so it gets there). `onReport(progress)` hears each answer (a LessonProgress).
 *
 * Returns the player's side of it (`observe`, `seeking`, `pause`, `ended`), or null when there's
 * nothing to track (not enrolled, or no uploaded video).
 */
export function useWatchProgress({ slug, courseSlug, lessonId, enabled, onReport }) {
  const handler = useRef(onReport);
  useEffect(() => {
    handler.current = onReport;
  });

  const watch = useMemo(() => {
    if (!enabled) return null;
    const tracker = createWatchTracker();
    let position = null;
    let sentPosition = null;
    let lastReport = clock();
    let stopped = false;
    // One report at a time, so they arrive in order; the last word as the page goes doesn't wait.
    let queue = Promise.resolve();

    const report = ({ exiting = false } = {}) => {
      if (stopped) return;
      const segments = tracker.take();
      const moved = position !== null && (sentPosition === null || Math.abs(position - sentPosition) >= 1);
      if (!segments.length && !moved) return;
      const input = { positionSeconds: Math.round(Math.max(0, position ?? 0) * 10) / 10, segments };
      sentPosition = position;
      lastReport = clock();
      const send = () => (exiting ? recordProgressOnExit : recordProgress)(slug, courseSlug, lessonId, input);
      const handled = (exiting ? send() : queue.then(send)).then(
        (progress) => handler.current?.(progress),
        (error) => {
          // No longer allowed (left the course, the lesson changed): stop reporting.
          if ([403, 404, 409].includes(error?.status)) {
            stopped = true;
            return;
          }
          // Anything else (offline, a token that lapsed as the page went): kept for the next report.
          tracker.restore(segments);
          sentPosition = null;
        },
      );
      if (!exiting) queue = handled;
    };

    return {
      /** Every `timeupdate`. */
      observe(time, { playing = true, rate = 1 } = {}) {
        position = time;
        tracker.observe(time, { at: clock(), playing, rate });
        if (playing && clock() - lastReport >= REPORT_EVERY_MS) report();
      },
      /** `seeking`: what played before the jump goes now; the new position goes with the next report. */
      seeking(time) {
        tracker.jump();
        if (tracker.pending > 0) report();
        position = time;
      },
      pause: () => report(),
      ended: () => report(),
      flush: report,
    };
  }, [enabled, slug, courseSlug, lessonId]);

  useEffect(() => {
    if (!watch) return undefined;
    const onVisibility = () => document.visibilityState === 'hidden' && watch.flush({ exiting: true });
    const onPageHide = () => watch.flush({ exiting: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      // Leaving the lesson within the app: the page stays, so an ordinary request will do.
      watch.flush();
    };
  }, [watch]);

  return watch;
}
