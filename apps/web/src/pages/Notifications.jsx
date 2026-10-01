import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import Button from '../components/Button.jsx';
import Icon from '../components/Icon.jsx';
import NotificationItem from '../components/NotificationItem.jsx';
import { Block } from '../components/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/States.jsx';
import { plural } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { PAGE_SIZE, getNotifications, notificationKeys, useMarkRead } from '../lib/notifications.js';
import { toast } from '../lib/toast.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import styles from './Notifications.module.scss';

/**
 * Every notification (/notifications), newest first, from all of this person's schools, a page at
 * a time ("Load more"), with an Unread filter and "Mark all as read". New ones appear at the top
 * as they arrive (the bell keeps the lists live).
 */
export default function Notifications() {
  const [params] = useSearchParams();
  const unreadOnly = params.get('filter') === 'unread';
  const markRead = useMarkRead();
  const [loaded, setLoaded] = useState('');
  const firstNew = useRef(null);
  const focusFrom = useRef(null);
  const heading = useRef(null);
  useDocumentTitle('Notifications');

  const list = useInfiniteQuery({
    queryKey: notificationKeys.list(unreadOnly),
    queryFn: ({ pageParam, signal }) => getNotifications({ cursor: pageParam, unread: unreadOnly, limit: PAGE_SIZE }, signal),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 30_000,
  });

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = list.data?.pages[0]?.unread ?? 0;

  // After "Load more", focus moves to the first of the new ones, so keyboard users carry on there.
  useEffect(() => {
    if (focusFrom.current === null || items.length <= focusFrom.current) return;
    focusFrom.current = null;
    firstNew.current?.querySelector('a, [tabindex]')?.focus();
  }, [items.length]);

  const loadMore = async () => {
    focusFrom.current = items.length;
    const result = await list.fetchNextPage();
    const now = result.data?.pages.flatMap((page) => page.items).length ?? items.length;
    setLoaded(`${plural(now - items.length, 'more notification')} loaded.`);
  };

  // The button goes once nothing is unread: focus moves to the page's title.
  const markAll = () => {
    heading.current?.focus();
    return markRead().then(
      () => toast('All marked as read'),
      (error) => toast(errorMessage(error), { tone: 'error' }),
    );
  };

  return (
    <div className={`page ${styles.page}`}>
      <header className={styles.header}>
        <div className={styles.titles}>
          <h1 ref={heading} tabIndex={-1} className={styles.title}>
            Notifications
          </h1>
          {list.data && <p className={`${styles.meta} tabular`}>{unread ? `${unread} unread` : "You're all caught up"}</p>}
        </div>
        <div className={styles.actions}>
          {unread > 0 && (
            <Button size="sm" icon="check" onClick={markAll}>
              Mark all as read
            </Button>
          )}
          <Button size="sm" variant="ghost" icon="sliders" to="/account/notifications">
            Settings
          </Button>
        </div>
      </header>

      <nav className={styles.filters} aria-label="Show notifications">
        <Link to="/notifications" replace className={styles.filter} aria-current={!unreadOnly ? 'page' : undefined}>
          All
        </Link>
        <Link to="/notifications?filter=unread" replace className={styles.filter} aria-current={unreadOnly ? 'page' : undefined}>
          Unread
          {unread > 0 && <span className={`${styles.count} tabular`}>{unread}</span>}
        </Link>
      </nav>

      {list.isPending ? (
        <div className={styles.list} aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles.skeleton}>
              <Block height="3.25rem" radius="var(--radius-md)" />
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState title="Couldn't load your notifications" error={list.error} onRetry={() => list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}>
          {unreadOnly ? "You've read everything." : 'New courses, lessons, handed-in work and grades will show up here.'}
        </EmptyState>
      ) : (
        <>
          <ul className={styles.list}>
            {items.map((notification, index) => (
              <li key={notification.id} ref={index === focusFrom.current ? firstNew : undefined}>
                <NotificationItem notification={notification} onOpen={(item) => !item.readAt && markRead([item.id]).catch(() => {})} />
              </li>
            ))}
          </ul>
          {list.hasNextPage ? (
            <div className={styles.more}>
              <Button icon="chevronDown" busy={list.isFetchingNextPage} onClick={loadMore}>
                Load more
              </Button>
            </div>
          ) : (
            items.length > PAGE_SIZE && (
              <p className={styles.end}>
                <Icon name="check" size={16} />
                That's everything.
              </p>
            )
          )}
        </>
      )}
      <p className="visually-hidden" aria-live="polite">
        {loaded}
      </p>
    </div>
  );
}
