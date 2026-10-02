import { z } from 'zod';
import { uuid } from './common.js';

export const NOTIFICATION_TYPES = [
  'course.published',
  'lesson.published',
  'assignment.submitted',
  'assignment.graded',
  'video.processed',
  'discussion.reply',
  'discussion.posted',
  'discussion.reported',
  'live.scheduled',
  'live.reminder',
  'live.started',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationChannels {
  inApp: boolean;
  email: boolean;
}
export type NotificationSettings = Record<NotificationType, NotificationChannels>;

/** What each person gets unless they choose otherwise. */
export const NOTIFICATION_DEFAULTS: NotificationSettings = {
  'course.published': { inApp: true, email: false },
  'lesson.published': { inApp: true, email: false },
  'assignment.submitted': { inApp: true, email: false },
  'assignment.graded': { inApp: true, email: true },
  'video.processed': { inApp: true, email: false },
  'discussion.reply': { inApp: true, email: false },
  'discussion.posted': { inApp: true, email: false },
  'discussion.reported': { inApp: true, email: true },
  'live.scheduled': { inApp: true, email: false },
  'live.reminder': { inApp: true, email: true },
  'live.started': { inApp: true, email: false },
};

/** Settings as stored, completed with the defaults; anything malformed falls back to them. */
export function notificationSettings(stored: unknown): NotificationSettings {
  const saved = stored && typeof stored === 'object' ? (stored as Record<string, Partial<NotificationChannels>>) : {};
  return Object.fromEntries(
    NOTIFICATION_TYPES.map((type) => {
      const own = saved[type];
      const fallback = NOTIFICATION_DEFAULTS[type];
      return [type, { inApp: typeof own?.inApp === 'boolean' ? own.inApp : fallback.inApp, email: typeof own?.email === 'boolean' ? own.email : fallback.email }];
    }),
  ) as NotificationSettings;
}

/**
 * Everything needed to show a notification without asking for more: the text, written when it's
 * made, and the in-app address it points to.
 */
export interface NotificationData {
  title: string;
  body: string;
  /** An address inside the web app, such as /s/riverside/c/piano/l/{id}. */
  path: string;
  schoolName: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  schoolId: string;
  data: NotificationData;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPage {
  items: Notification[];
  nextCursor: string | null;
  unread: number;
}

export const notificationsQuery = z.strictObject({
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unread: z.enum(['true', 'false']).optional(),
});
export type NotificationsQuery = z.infer<typeof notificationsQuery>;

/** Marks these as read, or every notification when `ids` is left out. */
export const markReadInput = z.strictObject({ ids: z.array(uuid).min(1).max(100).optional() });
export type MarkReadInput = z.infer<typeof markReadInput>;

export const notificationSettingsInput = z.strictObject({
  settings: z.partialRecord(z.enum(NOTIFICATION_TYPES), z.strictObject({ inApp: z.boolean(), email: z.boolean() })),
});
export type NotificationSettingsInput = z.infer<typeof notificationSettingsInput>;
