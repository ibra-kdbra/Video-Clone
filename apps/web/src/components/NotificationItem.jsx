import { Link } from 'react-router-dom';

import { iconFor } from '../lib/notificationTypes.js';
import { timeAgo } from '../lib/format.js';
import { safeNext } from '../lib/paths.js';
import Icon from './Icon.jsx';
import styles from './NotificationItem.module.scss';

/**
 * One notification: its title, a line of detail, the school and how long ago, unread ones marked
 * with a dot (and said so to screen readers). It links to its place in the app (`data.path`, an
 * address on this site only); following it calls `onOpen`, which marks it read.
 */
export default function NotificationItem({ notification, onOpen, compact = false }) {
  const { data, readAt, createdAt } = notification;
  const unread = !readAt;
  const to = safeNext(data.path, null);
  const content = (
    <>
      <span className={styles.icon} aria-hidden="true">
        <Icon name={iconFor(notification.type)} size={18} />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>
          {unread && <span className="visually-hidden">Unread: </span>}
          {data.title}
        </span>
        {data.body && <span className={styles.body}>{data.body}</span>}
        <span className={styles.meta}>
          {data.schoolName}
          <span aria-hidden="true"> · </span>
          <span className="visually-hidden">, </span>
          <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>
            {timeAgo(createdAt)}
          </time>
        </span>
      </span>
      {unread && <span className={styles.dot} aria-hidden="true" />}
    </>
  );
  const className = `${styles.item} ${compact ? styles.compact : ''}`;
  return to ? (
    <Link to={to} className={className} data-unread={unread || undefined} onClick={() => onOpen?.(notification)}>
      {content}
    </Link>
  ) : (
    <div className={className} data-unread={unread || undefined}>
      {content}
    </div>
  );
}
