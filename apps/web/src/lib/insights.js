import { formatClock } from './format.js';

/**
 * Course insights in the browser, without the React: a video's retention as a series of points,
 * what it says in words, and the ticks of its time axis.
 */

/**
 * The retention curve: for each stretch of the video (`segmentSeconds` long), how many of those who
 * started watching reached it, and that as a share of them (0–100).
 */
export function retentionSeries(retention) {
  if (!retention) return null;
  const { segmentSeconds, viewers, counts } = retention;
  const points = counts.map((count, index) => ({
    index,
    start: index * segmentSeconds,
    end: (index + 1) * segmentSeconds,
    viewers: count,
    percent: viewers ? Math.round((count / viewers) * 1000) / 10 : 0,
  }));
  return { segmentSeconds, viewers, points, duration: counts.length * segmentSeconds };
}

const share = (value) => `${Math.round(value)}%`;

/** A fall of at least this many points from one stretch to the next counts as the place people stop. */
const NOTABLE_DROP = 15;

/**
 * The curve in a sentence or two, for everyone (and for screen readers, which can't see it):
 * where the most viewers stop (one clear drop), or by when half have stopped (a gradual decline),
 * and how many reach the end.
 */
export function describeRetention(series) {
  if (!series || series.viewers === 0 || series.points.length === 0) return 'No one has watched this video yet.';
  const { points } = series;
  const end = points.at(-1).percent;
  const reach = `${share(end)} reach the end.`;
  if (end >= 80) return `Most viewers watch to the end: ${reach}`;
  let at = -1;
  let drop = 0;
  for (let i = 1; i < points.length; i++) {
    const fall = points[i - 1].percent - points[i].percent;
    if (fall > drop) {
      drop = fall;
      at = i;
    }
  }
  if (drop >= NOTABLE_DROP) return `Most viewers stop around ${formatClock(points[at].start)}, where ${share(drop)} of them leave. ${reach}`;
  const half = points.find((point) => point.percent < 50);
  if (half) return `Viewers leave gradually: half have stopped by ${formatClock(half.start)}. ${reach}`;
  return `Most viewers watch to the end: ${reach}`;
}

const STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

/** Round times (in seconds) along an axis `duration` long, at most `most` of them, from 0. */
export function timeTicks(duration, most = 6) {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const step = STEPS.find((candidate) => duration / candidate <= most) ?? Math.ceil(duration / most / 3600) * 3600;
  const ticks = [];
  for (let time = 0; time <= duration + 1e-9; time += step) ticks.push(time);
  return ticks;
}

/** "3 of 8", for "completed of started" counts. */
export const ofTotal = (part, whole) => `${part} of ${whole}`;
