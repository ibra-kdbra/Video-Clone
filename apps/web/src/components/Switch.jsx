import { useId } from 'react';

import styles from './Switch.module.scss';

/**
 * An on/off setting that applies at once (Published, Free preview): a labelled switch with an
 * explanation under the label. While `busy`, presses are ignored but focus stays put.
 */
export default function Switch({ label, hint, checked, onChange, busy = false, disabled = false }) {
  const id = useId();
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className={styles.hint}>
            {hint}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        className={styles.switch}
        aria-checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-busy={busy || undefined}
        disabled={disabled}
        onClick={() => !busy && onChange(!checked)}
      >
        <span className={styles.thumb} />
      </button>
    </div>
  );
}
