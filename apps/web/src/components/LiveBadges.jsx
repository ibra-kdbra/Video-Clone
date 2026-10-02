import Icon from './Icon.jsx';
import styles from './LiveSchedule.module.scss';

const MONTH = new Intl.DateTimeFormat('en', { month: 'short' });
const DAY = new Intl.DateTimeFormat('en', { day: 'numeric' });
const WEEKDAY = new Intl.DateTimeFormat('en', { weekday: 'short' });

/** The class's day, as on a calendar page. */
export function DateTile({ iso, live = false }) {
  const date = new Date(iso);
  return (
    <span className={styles.tile} data-live={live || undefined} aria-hidden="true">
      {live ? (
        <Icon name="broadcast" size={22} />
      ) : (
        <>
          <span className={styles.tileMonth}>{MONTH.format(date)}</span>
          <span className={styles.tileDay}>{DAY.format(date)}</span>
          <span className={styles.tileWeekday}>{WEEKDAY.format(date)}</span>
        </>
      )}
    </span>
  );
}

/** The pulsing "Live" badge. */
export function LiveBadge({ label = 'Live' }) {
  return (
    <span className={styles.liveBadge}>
      <span className={styles.pulse} aria-hidden="true" />
      {label}
    </span>
  );
}
