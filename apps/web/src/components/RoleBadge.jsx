import { ROLE_LABELS } from '../lib/roles.js';
import styles from './RoleBadge.module.scss';

/** A member's role in a school, each role in its own color; `glass` for use on a school's gradient. */
export default function RoleBadge({ role, glass = false, className = '' }) {
  return (
    <span className={`${styles.badge} ${glass ? styles.glass : ''} ${className}`} data-role={role}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}
