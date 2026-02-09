import styles from './Loader.module.scss';

const Loader = ({ label = 'Loading amazing content...' }) => (
  <div className={styles.wrapper}>
    <div className={styles.spinner} />
    <p className={styles.label}>{label}</p>
  </div>
);

export default Loader;
