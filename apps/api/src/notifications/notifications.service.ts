import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type Notification,
  type NotificationPage,
  type NotificationSettings,
  type NotificationSettingsInput,
  type NotificationsQuery,
  type NotificationType,
  notificationSettings,
} from '@grand/contracts';
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import { DatabaseService, type Tx } from '../database/database.service.js';
import { notifications, users } from '../database/schema.js';
import { RealtimeService } from '../realtime/realtime.service.js';

type NotificationRecord = typeof notifications.$inferSelect;

const toNotification = (row: NotificationRecord): Notification => ({
  id: row.id,
  type: row.type as NotificationType,
  schoolId: row.schoolId,
  data: row.data,
  createdAt: row.createdAt.toISOString(),
  readAt: row.readAt?.toISOString() ?? null,
});

/** Pages go newest first; the cursor is the last item's time and id. */
const encodeCursor = (row: NotificationRecord) => Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(at ?? '');
  if (Number.isNaN(createdAt.getTime()) || !id || !/^[0-9a-f-]{36}$/.test(id)) {
    throw new ApiException(HttpStatus.BAD_REQUEST, 'bad_request', 'This page link is not valid.');
  }
  return { createdAt, id };
}

/**
 * A person's notifications, from every school they're in. The worker writes them; here they're
 * listed, marked read (on every open device at once), and chosen per kind and channel.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(userId: string, query: NotificationsQuery): Promise<NotificationPage> {
    return this.db.transaction({ userId }, async (tx) => {
      const after = query.cursor ? decodeCursor(query.cursor) : null;
      const rows = await tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            query.unread === 'true' ? isNull(notifications.readAt) : undefined,
            after
              ? or(lt(notifications.createdAt, after.createdAt), and(eq(notifications.createdAt, after.createdAt), lt(notifications.id, after.id)))
              : undefined,
          ),
        )
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      return {
        items: page.map(toNotification),
        nextCursor: rows.length > query.limit ? encodeCursor(page.at(-1)!) : null,
        unread: await this.unread(tx, userId),
      };
    });
  }

  /** Marks these notifications (or all of them) read, and tells the person's other devices. */
  async markRead(userId: string, ids: string[] | undefined): Promise<{ unread: number }> {
    const unread = await this.db.transaction({ userId }, async (tx) => {
      await tx
        .update(notifications)
        .set({ readAt: sql`now()` })
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), ids ? inArray(notifications.id, ids) : undefined));
      return this.unread(tx, userId);
    });
    this.realtime.emitToUser(userId, 'notification:read', { ids: ids ?? 'all', unread });
    return { unread };
  }

  async settings(userId: string): Promise<NotificationSettings> {
    const [row] = await this.db.transaction({ userId }, (tx) => tx.select({ settings: users.notificationSettings }).from(users).where(eq(users.id, userId)));
    return notificationSettings(row?.settings);
  }

  async updateSettings(userId: string, input: NotificationSettingsInput): Promise<NotificationSettings> {
    return this.db.transaction({ userId }, async (tx) => {
      const [row] = await tx.select({ settings: users.notificationSettings }).from(users).where(eq(users.id, userId)).for('update');
      const merged = { ...notificationSettings(row?.settings), ...input.settings };
      await tx.update(users).set({ notificationSettings: merged }).where(eq(users.id, userId));
      return notificationSettings(merged);
    });
  }

  private async unread(tx: Tx, userId: string): Promise<number> {
    const [row] = await tx.select({ unread: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return row?.unread ?? 0;
  }
}
