import Icon from './Icon.jsx';
import styles from './States.module.scss';

/** A calm "nothing here" message with an optional action. */
export function EmptyState({ icon = 'search', title, titleAs: Title = 'h2', children, action }) {
  return (
    <div className={styles.state}>
      <span className={styles.icon}>
        <Icon name={icon} size={26} />
      </span>
      <Title className={styles.title}>{title}</Title>
      {children && <p className={styles.text}>{children}</p>}
      {action}
    </div>
  );
}

/** Something failed: what happened, in plain words, and a way to try again. */
export function ErrorState({ error, onRetry, title = "Couldn't load this", titleAs: Title = 'h2' }) {
  return (
    <div className={`${styles.state} ${styles.error}`} role="alert">
      <span className={styles.icon}>
        <Icon name="alert" size={26} />
      </span>
      <Title className={styles.title}>{title}</Title>
      <p className={styles.text}>{error?.message || 'Something went wrong. Please try again.'}</p>
      {onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          <Icon name="refresh" size={18} />
          Try again
        </button>
      )}
    </div>
  );
}

/** A quiet informational banner (not an error), e.g. which platform the videos come from. */
export function Notice({ children }) {
  return (
    <p className={styles.notice} role="status">
      <Icon name="alert" size={18} />
      <span>{children}</span>
    </p>
  );
}
