import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { errorMessage } from '../lib/forms.js';
import { useMarkRead } from '../lib/notifications.js';
import { toast } from '../lib/toast.js';
import Icon from './Icon.jsx';
import NotificationItem from './NotificationItem.jsx';
import { Block } from './Skeleton.jsx';
import styles from './NotificationPanel.module.scss';

/**
 * The bell's panel: recent notifications (unread ones marked), "Mark all as read", and a link to
 * the full list. Opening one goes to its place in the app and marks it read. Focus starts on the
 * panel's title, so screen readers announce where they are.
 */
export default function NotificationPanel({ query, titleId, headingRef, onClose }) {
  const markRead = useMarkRead();
  useEffect(() => headingRef.current?.focus(), [headingRef]);

  const page = query.data;
  const unread = page?.unread ?? 0;
  // The button goes once nothing is unread: focus moves to the panel's title, staying in the panel.
  const markAll = () => {
    headingRef.current?.focus();
    return markRead().then(
      () => toast('All marked as read'),
      (error) => toast(errorMessage(error), { tone: 'error' }),
    );
  };

  return (
    <>
      <header className={styles.head}>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className={styles.title}>
          Notifications
        </h2>
        {unread > 0 && (
          <button type="button" className={styles.markAll} onClick={markAll}>
            <Icon name="check" size={16} />
            Mark all as read
          </button>
        )}
      </header>
      <div className={styles.body}>
        {query.isPending ? (
          <div className={styles.loading} aria-busy="true">
            <Block height="3.5rem" radius="var(--radius-md)" />
            <Block height="3.5rem" radius="var(--radius-md)" />
          </div>
        ) : query.isError ? (
          <div className={styles.empty} role="alert">
            <p>{errorMessage(query.error)}</p>
            <button type="button" className={styles.retry} onClick={() => query.refetch()}>
              Try again
            </button>
          </div>
        ) : page.items.length === 0 ? (
          <div className={styles.empty}>
            <Icon name="bell" size={26} />
            <p>No notifications yet. New courses, lessons and grades will show up here.</p>
          </div>
        ) : (
          <ul className={styles.list}>
            {page.items.map((notification) => (
              <li key={notification.id}>
                <NotificationItem
                  notification={notification}
                  compact
                  onOpen={(item) => {
                    if (!item.readAt) markRead([item.id]).catch(() => {});
                    onClose(false);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className={styles.foot}>
        <Link to="/notifications" className={styles.footLink} onClick={() => onClose(false)}>
          See all notifications
        </Link>
        <Link to="/account/notifications" className={styles.settings} onClick={() => onClose(false)} aria-label="Notification settings" title="Notification settings">
          <Icon name="sliders" size={18} />
        </Link>
      </footer>
    </>
  );
}
