import Icon from './Icon.jsx';
import styles from './Badge.module.scss';

/**
 * A short status label: a course's Draft or Archived, a lesson's Free preview or Processing. Each
 * `tone` has its own colors (neutral, warning, success, info, teal, danger); `glass` is for use over
 * a picture. The words carry the meaning, so it reads the same without color.
 */
export default function Badge({ tone = 'neutral', icon, glass = false, className = '', children }) {
  return (
    <span className={`${styles.badge} ${glass ? styles.glass : ''} ${className}`} data-tone={tone}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}
