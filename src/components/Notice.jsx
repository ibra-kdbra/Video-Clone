import styles from './Notice.module.scss';

/** A quiet, informational banner (not an error): e.g. which platform the videos come from. */
const Notice = ({ children }) => (
  <p className={styles.notice} role="status">
    {children}
  </p>
);

export default Notice;
