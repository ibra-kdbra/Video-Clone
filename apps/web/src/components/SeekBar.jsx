import { useRef, useState } from 'react';

import { formatClock } from '../lib/format.js';
import { cueAt } from '../lib/storyboard.js';
import styles from './SeekBar.module.scss';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
// Half the preview's width, so it stays inside the player at either end.
const PREVIEW_HALF = 88;

/**
 * The player's seek bar: what's played, what's buffered, and a preview of where the pointer is,
 * with the storyboard thumbnail for that moment above it, while hovering or dragging. Dragging
 * only previews; the video jumps when the pointer lets go, so a long drag doesn't fetch every
 * stretch of video along the way. As a slider it takes the keyboard too: arrows move 5 seconds,
 * Page Up and Page Down a minute, Home and End to either end.
 */
export default function SeekBar({ time, duration, buffered, cues, onSeek, onScrub, onPreviewStart }) {
  const bar = useRef(null);
  const [hover, setHover] = useState(null);
  const [dragging, setDragging] = useState(false);
  const known = duration > 0;

  const at = (clientX) => {
    const box = bar.current.getBoundingClientRect();
    const share = clamp((clientX - box.left) / box.width, 0, 1);
    return { time: share * duration, x: clamp(clientX - box.left, Math.min(PREVIEW_HALF, box.width / 2), Math.max(box.width - PREVIEW_HALF, box.width / 2)) };
  };

  const onPointerDown = (event) => {
    if (!known || event.button > 0) return;
    event.preventDefault();
    bar.current.setPointerCapture(event.pointerId);
    const point = at(event.clientX);
    setDragging(true);
    setHover(point);
    onPreviewStart?.();
    onScrub?.(point.time);
  };

  const onPointerMove = (event) => {
    if (!known) return;
    const point = at(event.clientX);
    if (!dragging && event.pointerType !== 'mouse') return;
    if (!hover) onPreviewStart?.();
    setHover(point);
    if (dragging) onScrub?.(point.time);
  };

  const finish = (event) => {
    if (!dragging) return;
    setDragging(false);
    onSeek(at(event.clientX).time);
    onScrub?.(null);
    if (event.pointerType !== 'mouse') setHover(null);
  };

  const onKeyDown = (event) => {
    if (!known) return;
    const steps = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -60, PageUp: 60 };
    let target = null;
    if (event.key in steps) target = time + steps[event.key];
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = duration;
    if (target === null) return;
    event.preventDefault();
    // The player's own arrow shortcuts mustn't act on the same key press.
    event.stopPropagation();
    onSeek(clamp(target, 0, duration));
  };

  const shown = dragging && hover ? hover.time : time;
  const share = (value) => (known ? clamp(value / duration, 0, 1) : 0);
  const cue = hover ? cueAt(cues, hover.time) : null;

  return (
    <div
      ref={bar}
      className={styles.bar}
      data-active={dragging || Boolean(hover) || undefined}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration) || 0}
      aria-valuenow={Math.round(shown) || 0}
      aria-valuetext={`${formatClock(shown)} of ${formatClock(duration)}`}
      aria-disabled={!known || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={() => !dragging && setHover(null)}
      onKeyDown={onKeyDown}
    >
      <div className={styles.track}>
        {known &&
          buffered.map(([start, end]) => (
            <span key={start} className={styles.buffered} style={{ left: `${share(start) * 100}%`, width: `${(share(end) - share(start)) * 100}%` }} />
          ))}
        {hover && !dragging && <span className={styles.hovered} style={{ transform: `scaleX(${share(hover.time)})` }} />}
        <span className={styles.played} style={{ transform: `scaleX(${share(shown)})` }} />
      </div>
      <span className={styles.thumb} style={{ left: `${share(shown) * 100}%` }} />

      {hover && (
        <div className={styles.preview} style={{ left: `${hover.x}px` }} aria-hidden="true">
          {cue && (
            <span
              className={styles.frame}
              style={{
                width: `${cue.width}px`,
                height: `${cue.height}px`,
                backgroundImage: `url("${cue.url}")`,
                backgroundPosition: `-${cue.x}px -${cue.y}px`,
              }}
            />
          )}
          <span className={`${styles.previewTime} tabular`}>{formatClock(hover.time)}</span>
        </div>
      )}
    </div>
  );
}
