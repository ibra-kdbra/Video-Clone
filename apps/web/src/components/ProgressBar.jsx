import styles from './ProgressBar.module.scss';

/**
 * A thin bar for how far along something is (a course, a lesson, a completion rate), 0–100. With
 * `label` it's a progressbar that names itself; without one it's decoration beside text that says
 * the same (`aria-hidden`). `tone`: 'accent' (the default) or 'success'.
 */
export default function ProgressBar({ value, label, valueText, tone = 'accent', size = 'sm', className = '' }) {
  const percent = Math.min(100, Math.max(0, Number(value) || 0));
  const a11y = label
    ? { role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(percent), 'aria-valuetext': valueText }
    : { 'aria-hidden': true };
  return (
    <span className={`${styles.bar} ${styles[size]} ${className}`} data-tone={tone} {...a11y}>
      <span className={styles.fill} style={{ '--value': percent / 100 }} />
    </span>
  );
}
