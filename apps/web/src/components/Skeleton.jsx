import styles from './Skeleton.module.scss';

/** A placeholder that holds the layout while content loads (hidden from screen readers). */
export function Block({ width = '100%', height = '1rem', radius }) {
  return <div className={styles.block} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}
