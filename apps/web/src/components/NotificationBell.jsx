import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';

import { RECENT_SIZE, badgeCount, getNotifications, notificationKeys, useNotificationsLive } from '../lib/notifications.js';
import { toast } from '../lib/toast.js';
import Icon from './Icon.jsx';
import styles from './NotificationBell.module.scss';

// The list itself is its own chunk, loaded the first time the bell is opened.
const NotificationPanel = lazy(() => import('./NotificationPanel.jsx'));

/**
 * The bell in the top bar, for people signed in: a badge with the unread count, and a panel of
 * recent notifications. It keeps every notification list live (new ones arrive over the real-time
 * connection, and reading one on another device marks it here too); a new one also gets a quiet
 * toast while the panel is closed. The panel closes with Escape (focus back on the bell), a press
 * outside, tabbing out of it, or on going to another page.
 */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const button = useRef(null);
  const heading = useRef(null);
  const panelId = useId();
  const { pathname } = useLocation();
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });

  const recent = useQuery({
    queryKey: notificationKeys.recent,
    queryFn: ({ signal }) => getNotifications({ limit: RECENT_SIZE }, signal),
    staleTime: 60_000,
    // A fresh look every few minutes, in case the live connection missed something.
    refetchInterval: 5 * 60_000,
  });

  useNotificationsLive({
    onNew: (notification) => {
      if (!openRef.current && document.visibilityState === 'visible') toast(notification.data.title, { tone: 'info' });
    },
  });

  // A new page closes the panel (following a notification, or the "See all" link).
  useEffect(() => setOpen(false), [pathname]);

  const close = (returnFocus) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  // While open: a press outside closes it; Escape (wherever focus is) closes it and returns to the bell.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => root.current && !root.current.contains(event.target) && setOpen(false);
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = recent.data?.unread ?? 0;
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <div
      className={styles.root}
      ref={root}
      // Tabbing out of the panel closes it (focus has already moved on).
      onBlur={(event) => open && event.relatedTarget && !root.current?.contains(event.relatedTarget) && setOpen(false)}
    >
      <button
        ref={button}
        type="button"
        className={styles.bell}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="bell" size={21} />
        {unread > 0 && (
          <span className={`${styles.badge} tabular`} aria-hidden="true">
            {badgeCount(unread)}
          </span>
        )}
      </button>

      {open && (
        <div id={panelId} className={styles.panel} role="dialog" aria-labelledby={`${panelId}-title`}>
          <Suspense fallback={<div className={styles.loading} aria-busy="true" />}>
            <NotificationPanel query={recent} titleId={`${panelId}-title`} headingRef={heading} onClose={close} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
