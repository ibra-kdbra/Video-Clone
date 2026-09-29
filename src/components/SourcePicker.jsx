import { useEffect, useId, useRef, useState } from 'react';

import { toggleSource, useSources } from '../lib/preferences.js';
import { SOURCES, SOURCE_LABELS } from '../lib/sources.js';
import Icon, { SourceMark } from './Icon.jsx';
import styles from './SourcePicker.module.scss';

/** Which platforms to mix into the feed and search. A small disclosure menu of switches. */
export default function SourcePicker() {
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
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.marks} aria-hidden="true">
          {sources.map((source) => (
            <SourceMark key={source} source={source} size={16} />
          ))}
        </span>
        <span className={styles.triggerLabel}>Sources</span>
        <Icon name="chevronDown" size={16} />
      </button>

      <div id={panelId} className={styles.panel} hidden={!open}>
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
      </div>
    </div>
  );
}
