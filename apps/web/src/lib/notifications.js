import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useLiveSocket } from './live.js';
import { apiFetch } from './session.js';

/**
 * Notifications: the API calls, the cached lists (the bell's recent ones and the full, paged list)
 * and keeping them in step with the live connection. The bell is in the top bar on every page, so
 * this module stays small, and doesn't use @grand/contracts (which would bring zod along).
 */

/** The bell shows this many; the full list pages in steps of PAGE_SIZE. */
export const RECENT_SIZE = 8;
export const PAGE_SIZE = 20;

export const notificationKeys = {
  all: ['notifications'],
  recent: ['notifications', 'recent'],
  list: (unreadOnly) => ['notifications', 'list', unreadOnly ? 'unread' : 'all'],
  settings: ['notificationSettings'],
};

export function getNotifications({ cursor, unread = false, limit = PAGE_SIZE } = {}, signal) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  if (unread) params.set('unread', 'true');
  return apiFetch(`/notifications?${params}`, { signal });
}

/** Marks these notifications read, or all of them when `ids` is left out. */
export const markNotificationsRead = (ids) => apiFetch('/notifications/read', { method: 'POST', body: ids ? { ids } : {} });
export const getNotificationSettings = (signal) => apiFetch('/notifications/settings', { signal });
export const saveNotificationSettings = (settings) => apiFetch('/notifications/settings', { method: 'PUT', body: { settings } });

// Cache updates (pure) -----------------------------------------------------------------------------

/** One page (`{ items, nextCursor, unread }`) with a new notification first, unless it's there already. */
export function addToPage(page, notification, { limit } = {}) {
  if (!page) return page;
  if (page.items.some((item) => item.id === notification.id)) return page;
  const items = [notification, ...page.items];
  return { ...page, items: limit ? items.slice(0, limit) : items, unread: page.unread + (notification.readAt ? 0 : 1) };
}

/** One page with these ids (or every one, for 'all') marked read at `readAt`, and the unread count from the server. */
export function markPage(page, ids, unread, readAt = new Date().toISOString()) {
  if (!page) return page;
  const chosen = ids === 'all' ? null : new Set(ids);
  return {
    ...page,
    unread: Number.isFinite(unread) ? unread : page.unread,
    items: page.items.map((item) => (!item.readAt && (!chosen || chosen.has(item.id)) ? { ...item, readAt } : item)),
  };
}

/** The same for a paged list (useInfiniteQuery's `{ pages, pageParams }`): new ones go on the first page. */
export function addToPages(data, notification) {
  if (!data?.pages?.length) return data;
  if (data.pages.some((page) => page.items.some((item) => item.id === notification.id))) return data;
  const [first, ...rest] = data.pages;
  return { ...data, pages: [addToPage(first, notification), ...rest.map((page) => ({ ...page, unread: page.unread + (notification.readAt ? 0 : 1) }))] };
}

export function markPages(data, ids, unread, readAt) {
  if (!data?.pages) return data;
  return { ...data, pages: data.pages.map((page) => markPage(page, ids, unread, readAt)) };
}

/** Every cached list at once: a new notification arrived. */
export function addNotification(queryClient, notification) {
  queryClient.setQueryData(notificationKeys.recent, (page) => addToPage(page, notification, { limit: RECENT_SIZE }));
  queryClient.setQueryData(notificationKeys.list(false), (data) => addToPages(data, notification));
  queryClient.setQueryData(notificationKeys.list(true), (data) => addToPages(data, notification));
}

/** Every cached list at once: these (or 'all') were read, here or on another device. */
export function markRead(queryClient, ids, unread) {
  const readAt = new Date().toISOString();
  queryClient.setQueryData(notificationKeys.recent, (page) => markPage(page, ids, unread, readAt));
  queryClient.setQueryData(notificationKeys.list(false), (data) => markPages(data, ids, unread, readAt));
  // The unread list keeps what was just read on screen (crossed off), until it's next loaded.
  queryClient.setQueryData(notificationKeys.list(true), (data) => markPages(data, ids, unread, readAt));
}

/** "9+" past nine, so the badge stays round. */
export const badgeCount = (unread) => (unread > 9 ? '9+' : String(unread));

/** What a notification is about changes what's on screen: refresh it, if it's loaded. */
const STALE_AFTER = {
  'course.published': [['courses']],
  'lesson.published': [['course'], ['courses']],
  'assignment.submitted': [['submissions'], ['assignment'], ['insights']],
  'assignment.graded': [['assignment'], ['course'], ['lesson']],
  'video.processed': [['course'], ['lesson'], ['playback'], ['storage']],
  'discussion.reply': [['discussions']],
  'discussion.posted': [['discussions']],
  'discussion.reported': [['discussions']],
  'live.scheduled': [['live'], ['liveSchedule']],
  'live.reminder': [['live'], ['liveSchedule']],
  'live.started': [['live'], ['liveSchedule']],
};

/**
 * Keeps the notification lists live while signed in: `notification:new` adds one (and calls
 * `onNew`), `notification:read` marks them read on every device. After a reconnection the lists
 * are loaded again, since anything sent while the connection was down is lost.
 */
export function useNotificationsLive({ onNew } = {}) {
  const socket = useLiveSocket();
  const queryClient = useQueryClient();
  const handler = useRef(onNew);
  useEffect(() => {
    handler.current = onNew;
  });

  useEffect(() => {
    if (!socket) return undefined;
    let connectedBefore = socket.connected;
    const onNotification = (notification) => {
      if (!notification?.id || !notification.data) return;
      addNotification(queryClient, notification);
      for (const queryKey of STALE_AFTER[notification.type] ?? []) queryClient.invalidateQueries({ queryKey });
      handler.current?.(notification);
    };
    const onRead = (event) => {
      if (!event) return;
      markRead(queryClient, event.ids === 'all' ? 'all' : Array.isArray(event.ids) ? event.ids : [], event.unread);
    };
    const onConnect = () => {
      if (connectedBefore) queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      connectedBefore = true;
    };
    socket.on('notification:new', onNotification);
    socket.on('notification:read', onRead);
    socket.on('connect', onConnect);
    return () => {
      socket.off('notification:new', onNotification);
      socket.off('notification:read', onRead);
      socket.off('connect', onConnect);
    };
  }, [socket, queryClient]);
}

/**
 * Marks notifications read (these ids, or all of them when left out): at once in every cached
 * list, then on the server, whose unread count has the last word (and reaches the other devices).
 */
export function useMarkRead() {
  const queryClient = useQueryClient();
  return useCallback(
    (ids) => {
      const before = queryClient.getQueryData(notificationKeys.recent)?.unread ?? 0;
      markRead(queryClient, ids ?? 'all', ids ? Math.max(0, before - ids.length) : 0);
      return markNotificationsRead(ids).then(
        ({ unread }) => markRead(queryClient, ids ?? 'all', unread),
        (error) => {
          queryClient.invalidateQueries({ queryKey: notificationKeys.all });
          throw error;
        },
      );
    },
    [queryClient],
  );
}
