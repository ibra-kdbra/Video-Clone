import { HttpStatus } from '@nestjs/common';
import type { LiveMessage, LiveSession } from '@grand/contracts';
import { ApiException } from '../common/api-exception.js';
import type { SchoolContext } from '../common/request-context.js';
import type { CourseRecord } from '../courses/courses.service.js';
import type { liveMessages, liveSessions } from '../database/schema.js';

export type SessionRecord = typeof liveSessions.$inferSelect;
export type MessageRecord = typeof liveMessages.$inferSelect;

/** Who is looking at a class, and what they may do. */
export interface Viewing {
  school: SchoolContext;
  userId: string;
  course: CourseRecord;
  /** Runs the class: an editor of its course. */
  host: boolean;
  enrolled: boolean;
  /** May come in: a host, or a student enrolled in the published course. */
  canJoin: boolean;
}

/** Students can come into the waiting room this long before the start. */
export const WAITING_ROOM_MS = 15 * 60_000;
/** A meeting link shows this long before the start. */
const LINK_EARLY_MS = 10 * 60_000;

export const endsAt = (session: Pick<SessionRecord, 'startsAt' | 'durationMinutes'>) => new Date(session.startsAt.getTime() + session.durationMinutes * 60_000);

/** Whether a student may be in the class's room now (hosts always may, until it's over). */
export function roomOpen(session: Pick<SessionRecord, 'status' | 'startsAt'>, host: boolean, now = Date.now()) {
  if (session.status === 'live') return true;
  if (session.status !== 'scheduled') return false;
  return host || session.startsAt.getTime() - now <= WAITING_ROOM_MS;
}

export function toSession(
  session: SessionRecord,
  viewing: Viewing,
  extra: { hostUser: { id: string; name: string } | null; attendeeCount: number },
  now = Date.now(),
): LiveSession {
  // The stream's reference only for those who may join; a meeting link only once it's nearly time.
  let streamRef = viewing.canJoin ? session.streamRef : null;
  if (streamRef && session.provider === 'link' && !viewing.host) {
    const soon = session.status === 'live' || (session.status === 'scheduled' && session.startsAt.getTime() - now <= LINK_EARLY_MS);
    if (!soon) streamRef = null;
  }
  return {
    id: session.id,
    courseId: viewing.course.id,
    courseSlug: viewing.course.slug,
    courseTitle: viewing.course.title,
    title: session.title,
    description: session.description,
    startsAt: session.startsAt.toISOString(),
    endsAt: endsAt(session).toISOString(),
    durationMinutes: session.durationMinutes,
    status: session.status,
    provider: session.provider,
    streamRef,
    recordingRef: viewing.canJoin ? session.recordingRef : null,
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    host: extra.hostUser,
    canHost: viewing.host,
    canJoin: viewing.canJoin,
    attendeeCount: extra.attendeeCount,
  };
}

export function toMessage(
  message: MessageRecord,
  author: { name: string; host: boolean } | null,
  viewerIsHost: boolean,
): LiveMessage {
  const hidden = message.hiddenAt !== null;
  return {
    id: message.id,
    sessionId: message.sessionId,
    author: message.userId && author ? { id: message.userId, name: author.name, host: author.host } : null,
    body: hidden && !viewerIsHost ? '' : message.body,
    hidden,
    createdAt: message.createdAt.toISOString(),
  };
}

export const notStarted = () => new ApiException(HttpStatus.CONFLICT, 'conflict', "The class hasn't started yet.");
export const isOver = () => new ApiException(HttpStatus.CONFLICT, 'conflict', 'This class is over.');
