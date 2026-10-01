import { markReadInput, notificationSettings, notificationSettingsInput, notificationsQuery } from '@grand/contracts';

import { badRequest } from '../http.js';
import { iso } from '../logic.js';

/**
 * A person's notifications from every school (apps/api/src/notifications): newest first, paged by
 * a cursor of the last one's time and id, marked read on every open tab at once, and chosen per
 * kind and channel. The demo writes them itself (server.js `notify`) where the worker would.
 */

export const toNotification = (row) => ({ id: row.id, type: row.type, schoolId: row.schoolId, data: row.data, createdAt: iso(row.createdAt), readAt: iso(row.readAt) });

const encodeCursor = (row) =>
  btoa(`${iso(row.createdAt)}|${row.id}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
function decodeCursor(cursor) {
  let at = '';
  let id = '';
  try {
    [at = '', id = ''] = atob(cursor.replace(/-/g, '+').replace(/_/g, '/')).split('|');
  } catch {
    // Falls through.
  }
  const createdAt = Date.parse(at);
  if (Number.isNaN(createdAt) || !id || !/^[0-9a-f-]{36}$/.test(id)) throw badRequest('This page link is not valid.');
  return { createdAt, id };
}

const unreadCount = (db, userId) => db.count('notifications', (row) => row.userId === userId && !row.readAt);

export function register(router, server) {
  router.add('GET', '/notifications', { query: notificationsQuery }, (ctx) => {
    const { db, auth, query } = ctx;
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = db
      .filter('notifications', (row) => row.userId === auth.userId && (query.unread !== 'true' || !row.readAt))
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
      .filter((row) => !after || row.createdAt < after.createdAt || (row.createdAt === after.createdAt && row.id < after.id));
    const page = rows.slice(0, query.limit);
    return { items: page.map(toNotification), nextCursor: rows.length > query.limit ? encodeCursor(page.at(-1)) : null, unread: unreadCount(db, auth.userId) };
  });

  router.add('POST', '/notifications/read', { body: markReadInput, status: 200 }, (ctx) => {
    const { db, auth, body } = ctx;
    const ids = body.ids ? new Set(body.ids) : null;
    for (const row of db.filter('notifications', (item) => item.userId === auth.userId && !item.readAt && (!ids || ids.has(item.id)))) {
      db.update('notifications', row.id, { readAt: ctx.now });
    }
    const unread = unreadCount(db, auth.userId);
    server.emitToUser(auth.userId, 'notification:read', { ids: body.ids ?? 'all', unread });
    return { unread };
  });

  router.add('GET', '/notifications/settings', {}, (ctx) => notificationSettings(ctx.db.get('users', ctx.auth.userId)?.notificationSettings));

  router.add('PUT', '/notifications/settings', { body: notificationSettingsInput }, (ctx) => {
    const user = ctx.db.get('users', ctx.auth.userId);
    const merged = { ...notificationSettings(user?.notificationSettings), ...ctx.body.settings };
    ctx.db.update('users', ctx.auth.userId, { notificationSettings: merged });
    return notificationSettings(merged);
  });
}
