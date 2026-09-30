import { initials, toneFor } from '../lib/tone.js';
import styles from './Monogram.module.scss';

/**
 * A school's (or person's) emblem: initials on the gradient that `seed` (their address or id)
 * picks, like a streaming profile's picture. Decorative: the name is always written next to it.
 */
export default function Monogram({ name, seed, size = 40, round = false, letters = 2, className = '' }) {
  return (
    <span
      className={`${styles.monogram} ${round ? styles.round : ''} ${className}`}
      data-tone={toneFor(seed ?? name)}
      style={{ '--size': `${size}px` }}
      aria-hidden="true"
    >
      {initials(name, letters)}
    </span>
  );
}
