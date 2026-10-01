import { useEffect, useId, useRef, useState } from 'react';

import { formatClock, plural } from '../lib/format.js';
import { describeRetention, timeTicks } from '../lib/insights.js';
import styles from './RetentionChart.module.scss';

const HEIGHT = 220;
const PAD = { top: 14, right: 14, bottom: 30, left: 44 };
const Y_TICKS = [0, 25, 50, 75, 100];

/** The chart's width follows its box (ResizeObserver), so text and lines stay crisp at any size. */
function useWidth(ref, fallback = 640) {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** "1:20–1:25". */
const stretch = (point) => `${formatClock(point.start)}–${formatClock(point.end)}`;
const readout = (point, viewers) => `${stretch(point)}: ${point.percent}% still watching (${point.viewers} of ${plural(viewers, 'viewer')})`;

/**
 * Where viewers stop watching a video: for each 5-second stretch, the share of those who started
 * that reached it, as a stepped line over a light wash, with a time axis in m:ss. A sentence says
 * what it shows; hovering, or focusing the chart and using the arrow keys, reads out each stretch;
 * and the numbers are there as a table too.
 */
export default function RetentionChart({ series, title }) {
  const box = useRef(null);
  const width = useWidth(box);
  const [active, setActive] = useState(null);
  const hintId = useId();
  const tableId = useId();
  const { points, duration, viewers } = series;
  const summary = describeRetention(series);

  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (seconds) => PAD.left + (duration ? (seconds / duration) * plotWidth : 0);
  const y = (percent) => PAD.top + plotHeight - (percent / 100) * plotHeight;

  // A stepped line: each stretch is flat across its five seconds.
  const line = points.map((point, i) => `${i === 0 ? 'M' : 'L'}${x(point.start).toFixed(1)},${y(point.percent).toFixed(1)}H${x(point.end).toFixed(1)}`).join('');
  const area = points.length ? `${line}V${y(0)}H${x(0)}Z` : '';
  const ticks = timeTicks(duration, Math.max(2, Math.floor(plotWidth / 70)));
  const current = active === null ? null : points[active];

  const pick = (clientX) => {
    const rect = box.current.getBoundingClientRect();
    const seconds = ((clientX - rect.left - PAD.left) / plotWidth) * duration;
    const index = Math.min(points.length - 1, Math.max(0, Math.floor(seconds / series.segmentSeconds)));
    setActive(index);
  };

  const onKeyDown = (event) => {
    const last = points.length - 1;
    const from = active ?? -1;
    const moves = { ArrowRight: from + 1, ArrowLeft: from - 1, Home: 0, End: last, PageUp: from + 6, PageDown: from - 6 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    setActive(Math.min(last, Math.max(0, moves[event.key])));
  };

  if (viewers === 0)
    return (
      <div className={styles.chart}>
        <p className={styles.summary}>{summary}</p>
      </div>
    );

  return (
    <div className={styles.chart}>
      <p className={styles.summary}>{summary}</p>
      <div
        ref={box}
        className={styles.plot}
        tabIndex={0}
        role="group"
        aria-label={`${title}: share of viewers still watching, by time`}
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        onFocus={() => active === null && setActive(0)}
        onBlur={() => setActive(null)}
        onPointerMove={(event) => pick(event.clientX)}
        onPointerLeave={() => document.activeElement !== box.current && setActive(null)}
      >
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true" focusable="false" className={styles.svg}>
          {Y_TICKS.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? styles.baseline : styles.grid} />
              <text x={PAD.left - 8} y={y(tick)} className={styles.yLabel} dominantBaseline="middle" textAnchor="end">
                {tick}%
              </text>
            </g>
          ))}
          {ticks.map((tick) => (
            <text key={tick} x={x(tick)} y={HEIGHT - 8} className={styles.xLabel} textAnchor={tick === 0 ? 'start' : tick >= duration ? 'end' : 'middle'}>
              {formatClock(tick)}
            </text>
          ))}
          <path d={area} className={styles.area} />
          <path d={line} className={styles.line} />
          {current && (
            <g>
              <line x1={x((current.start + current.end) / 2)} x2={x((current.start + current.end) / 2)} y1={PAD.top} y2={y(0)} className={styles.crosshair} />
              <circle cx={x((current.start + current.end) / 2)} cy={y(current.percent)} r={5} className={styles.dot} />
            </g>
          )}
        </svg>
        {current && (
          <div
            className={styles.tooltip}
            style={{
              left: `${Math.min(width - 8, Math.max(8, x((current.start + current.end) / 2)))}px`,
              top: `${y(current.percent)}px`,
              '--shift': x((current.start + current.end) / 2) > width / 2 ? '-100%' : '0%',
            }}
            aria-hidden="true"
          >
            <strong className="tabular">{current.percent}%</strong>
            <span className="tabular">
              {stretch(current)} · {plural(current.viewers, 'viewer')}
            </span>
          </div>
        )}
      </div>
      <p id={hintId} className={styles.hint}>
        Focus the chart and use the arrow keys to read each 5-second stretch.
      </p>
      <p className="visually-hidden" aria-live="polite">
        {current ? readout(current, viewers) : ''}
      </p>
      <details className={styles.table}>
        <summary>Show the numbers</summary>
        <table aria-describedby={tableId}>
          <caption id={tableId} className="visually-hidden">
            {title}: viewers per 5-second stretch
          </caption>
          <thead>
            <tr>
              <th scope="col">Stretch</th>
              <th scope="col">Viewers</th>
              <th scope="col">Still watching</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.index}>
                <th scope="row" className="tabular">
                  {stretch(point)}
                </th>
                <td className="tabular">{point.viewers}</td>
                <td className="tabular">{point.percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
