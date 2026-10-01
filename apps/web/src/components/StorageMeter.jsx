import { formatBytes } from '../lib/format.js';
import styles from './StorageMeter.module.scss';

/**
 * How much of the school's video storage is in use: stored videos, plus the room held for uploads
 * still under way, against the quota. It turns amber past 80% and red past 95%.
 */
export default function StorageMeter({ usage }) {
  const { quotaBytes, usedBytes, reservedBytes, maxUploadBytes } = usage;
  const quota = Math.max(quotaBytes, 1);
  const taken = usedBytes + reservedBytes;
  const share = Math.min(1, taken / quota);
  const level = share > 0.95 ? 'full' : share > 0.8 ? 'high' : 'ok';
  const left = Math.max(0, quotaBytes - taken);

  return (
    <div className={styles.meter}>
      <div className={styles.numbers}>
        <span className={`${styles.used} tabular`}>{formatBytes(taken)}</span>
        <span className={`${styles.quota} tabular`}>of {formatBytes(quotaBytes)}</span>
      </div>
      <div
        className={styles.bar}
        data-level={level}
        role="meter"
        aria-label="Video storage used"
        aria-valuemin={0}
        aria-valuemax={quotaBytes}
        aria-valuenow={taken}
        aria-valuetext={`${formatBytes(taken)} of ${formatBytes(quotaBytes)} used`}
      >
        <span className={styles.stored} style={{ width: `${Math.min(1, usedBytes / quota) * 100}%` }} />
        <span className={styles.reserved} style={{ width: `${Math.min(1 - Math.min(1, usedBytes / quota), reservedBytes / quota) * 100}%` }} />
      </div>
      <ul className={styles.legend}>
        <li>
          <span className={styles.swatch} data-kind="stored" aria-hidden="true" />
          Videos: {formatBytes(usedBytes)}
        </li>
        {reservedBytes > 0 && (
          <li>
            <span className={styles.swatch} data-kind="reserved" aria-hidden="true" />
            Uploads in progress: {formatBytes(reservedBytes)}
          </li>
        )}
      </ul>
      <p className={styles.note}>
        {formatBytes(left)} left. Each video can be up to {formatBytes(maxUploadBytes)}.
      </p>
    </div>
  );
}
