import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';

import { toggleSource, useSources } from '../lib/preferences.js';
import { SOURCES, SOURCE_LABELS } from '../lib/sources.js';
import Icon, { SourceMark } from './Icon.jsx';
import styles from './SourcePicker.module.scss';

/**
 * Which platforms to mix into the feed and search: a small disclosure menu of switches.
 * `compact` (in the top bar) shows just the platforms' marks.
 */
export default function SourcePicker({ compact = false }) {
  const sources = useSources();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const button = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => root.current && !root.current.contains(event.target) && setOpen(false);
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={root}>
      <button
        ref={button}
        type="button"
        className={`${styles.trigger} ${compact ? styles.compact : ''}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        title="Choose sources"
      >
        <span className={styles.marks} aria-hidden="true">
          {sources.map((source) => (
            <SourceMark key={source} source={source} size={16} />
          ))}
        </span>
        <span className={compact ? 'visually-hidden' : styles.triggerLabel}>Sources</span>
        <Icon name="chevronDown" size={16} className={styles.chevron} />
      </button>

      <AnimatePresence>
      {open && (
      <m.div
        id={panelId}
        className={`${styles.panel} ${compact ? styles.alignEnd : ''}`}
        initial={{ opacity: 0, y: -6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.12 } }}
      >
        <p className={styles.heading}>Show videos from</p>
        {SOURCES.map((source) => {
          const on = sources.includes(source);
          const last = on && sources.length === 1;
          return (
            <button
              key={source}
              type="button"
              role="switch"
              aria-checked={on}
              aria-disabled={last || undefined}
              className={styles.option}
              onClick={() => !last && toggleSource(source)}
              title={last ? 'At least one source stays on' : undefined}
            >
              <SourceMark source={source} size={20} />
              <span className={styles.optionLabel}>{SOURCE_LABELS[source]}</span>
              <span className={styles.switch} aria-hidden="true" />
            </button>
          );
        })}
        <p className={styles.hint}>Twitch shows clips when it's connected on the server.</p>
      </m.div>
      )}
      </AnimatePresence>
    </div>
  );
}
