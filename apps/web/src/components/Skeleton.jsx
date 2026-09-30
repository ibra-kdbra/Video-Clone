import styles from './Skeleton.module.scss';

/** Placeholders that hold the layout while content loads (hidden from screen readers). */
export function CardSkeleton() {
  return (
    <div className={styles.card} aria-hidden="true">
      <div className={`${styles.block} ${styles.thumb}`} />
      <div className={`${styles.block} ${styles.line}`} style={{ width: '90%' }} />
      <div className={`${styles.block} ${styles.line}`} style={{ width: '55%' }} />
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className={styles.row} aria-hidden="true">
      <div className={`${styles.block} ${styles.thumb}`} />
      <div className={styles.rowText}>
        <div className={`${styles.block} ${styles.line}`} style={{ width: '95%' }} />
        <div className={`${styles.block} ${styles.line}`} style={{ width: '60%' }} />
      </div>
    </div>
  );
}

export function Block({ width = '100%', height = '1rem', radius }) {
  return <div className={styles.block} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}
