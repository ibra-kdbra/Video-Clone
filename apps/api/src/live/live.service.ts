import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type CreateLiveSessionInput,
  type LiveAttendance,
  type LiveKitAccess,
  type LiveMessage,
  type LiveOptions,
  type LiveProvider,
  type LiveScheduleQuery,
  type LiveSession,
  normalizeStreamRef,
  type UpdateLiveSessionInput,
} from '@grand/contracts';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiException, forbidden, notFound } from '../common/api-exception.js';
import type { SchoolContext } from '../common/request-context.js';
import { DatabaseService, type Tx } from '../database/database.service.js';
import { courses, enrollments, liveAttendance, liveMessages, liveSessions, users } from '../database/schema.js';
import { canEditCourse } from '../courses/course-access.js';
import { enrollmentRequired } from '../courses/lessons.service.js';
import { AuditService } from '../events/audit.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { isOver, notStarted, type SessionRecord, type Viewing } from './live-access.js';
import { LiveKitService } from './livekit.service.js';
import { LiveRoomService } from './live-room.service.js';
import { LiveStore } from './live-store.service.js';

const invalid = (path: string, message: string) => new ApiException(HttpStatus.BAD_REQUEST, 'validation_failed', message, [{ path, message }]);
const conflict = (message: string) => new ApiException(HttpStatus.CONFLICT, 'conflict', message);

/** A start time can't be in the past (a minute's grace for slow forms). */
const PAST_GRACE_MS = 60_000;

/**
 * Live classes: scheduling by the course's editors, starting and ending, the chat's history and
 * moderation, attendance, and access to the video (LiveKit tokens, who may speak).
 */
@Injectable()
export class LiveService {
  constructor(
    private readonly db: DatabaseService,
    private readonly store: LiveStore,
    private readonly room: LiveRoomService,
    private readonly livekit: LiveKitService,
    private readonly realtime: RealtimeService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  options(): LiveOptions {
    return { providers: this.livekit.enabled ? ['livekit', 'youtube', 'link'] : ['youtube', 'link'] };
  }

  /** Classes in the courses this person takes or teaches, across the school. */
  async schedule(school: SchoolContext, userId: string, query: LiveScheduleQuery): Promise<LiveSession[]> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const rows = await tx
        .select({ session: liveSessions, course: courses, enrolled: sql<boolean>`${enrollments.userId} is not null` })
        .from(liveSessions)
        .innerJoin(courses, eq(courses.id, liveSessions.courseId))
        .leftJoin(enrollments, and(eq(enrollments.courseId, courses.id), eq(enrollments.userId, userId)))
        .where(this.when(query.when))
        .orderBy(query.when === 'upcoming' ? asc(liveSessions.startsAt) : desc(liveSessions.startsAt))
        .limit(200);
      const mine = rows
        .map((row) => {
          const host = canEditCourse(school, userId, row.course);
          const canJoin = host || (row.enrolled && row.course.status === 'published');
          return { session: row.session, viewing: { school, userId, course: row.course, host, enrolled: row.enrolled, canJoin } satisfies Viewing };
        })
        .filter((row) => row.viewing.canJoin)
        .slice(0, query.limit);
      return this.store.describeMany(tx, mine);
    });
  }

  async list(school: SchoolContext, userId: string, courseSlug: string, query: LiveScheduleQuery): Promise<LiveSession[]> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewing = await this.store.viewCourse(tx, school, userId, courseSlug);
      const rows = await tx
        .select()
        .from(liveSessions)
        .where(and(eq(liveSessions.courseId, viewing.course.id), this.when(query.when)))
        .orderBy(query.when === 'upcoming' ? asc(liveSessions.startsAt) : desc(liveSessions.startsAt))
        .limit(query.limit);
      return this.store.describeMany(tx, rows.map((session) => ({ session, viewing })));
    });
  }

  /** Upcoming: scheduled or live, and cancelled ones not yet past. Past: ended. */
  private when(when: LiveScheduleQuery['when']) {
    return when === 'upcoming'
      ? or(inArray(liveSessions.status, ['scheduled', 'live']), and(eq(liveSessions.status, 'cancelled'), gt(liveSessions.startsAt, sql`now()`)))
      : eq(liveSessions.status, 'ended');
  }

  async get(school: SchoolContext, userId: string, courseSlug: string, sessionId: string): Promise<LiveSession> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewing = await this.store.viewCourse(tx, school, userId, courseSlug);
      return this.store.describe(tx, viewing, await this.store.session(tx, viewing, sessionId));
    });
  }

  async create(school: SchoolContext, userId: string, courseSlug: string, input: CreateLiveSessionInput, ip: string | null): Promise<LiveSession> {
    if (input.provider === 'livekit' && !this.livekit.enabled) throw invalid('provider', "Live video in the browser isn't set up on this server. Use YouTube Live or a meeting link.");
    const startsAt = new Date(input.startsAt);
    if (startsAt.getTime() < Date.now() - PAST_GRACE_MS) throw invalid('startsAt', 'Choose a time in the future');
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewing = await this.hosting(tx, school, userId, courseSlug);
      const [session] = await tx
        .insert(liveSessions)
        .values({
          schoolId: school.id,
          courseId: viewing.course.id,
          title: input.title,
          description: input.description,
          startsAt,
          durationMinutes: input.durationMinutes,
          provider: input.provider,
          streamRef: input.streamRef,
          createdBy: userId,
        })
        .returning();
      if (viewing.course.status === 'published') {
        await this.outbox.add(tx, 'live.scheduled', { sessionId: session!.id, courseId: viewing.course.id, actorId: userId }, school.id);
      }
      await this.audit.record(tx, { action: 'live.scheduled', actorId: userId, schoolId: school.id, targetType: 'live_session', targetId: session!.id, ip });
      return this.store.describe(tx, viewing, session!);
    });
  }

  /**
   * Changing a class. Before it starts, anything; while it's on, its text, length and stream; once
   * it's over, its text and recording. A cancelled class stays as it was.
   */
  async update(school: SchoolContext, userId: string, courseSlug: string, sessionId: string, input: UpdateLiveSessionInput): Promise<LiveSession> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewing = await this.hosting(tx, school, userId, courseSlug);
      const session = await this.store.session(tx, viewing, sessionId, { forUpdate: true });
      if (session.status === 'cancelled') throw conflict('This class was cancelled.');
      const changes: Partial<SessionRecord> = {};
      if (input.title !== undefined) changes.title = input.title;
      if (input.description !== undefined) changes.description = input.description;
      if (input.startsAt !== undefined) {
        if (session.status !== 'scheduled') throw conflict("A class that has started keeps its start time.");
        const startsAt = new Date(input.startsAt);
        if (startsAt.getTime() < Date.now() - PAST_GRACE_MS) throw invalid('startsAt', 'Choose a time in the future');
        changes.startsAt = startsAt;
        // A new time gets a new reminder.
        changes.remindedAt = null;
      }
      if (input.durationMinutes !== undefined) {
        if (session.status === 'ended') throw conflict('This class is over.');
        changes.durationMinutes = input.durationMinutes;
      }
      if (input.streamRef !== undefined) {
        if (session.status === 'ended') throw conflict('This class is over: add a recording instead.');
        changes.streamRef = parseStreamRef(session.provider, input.streamRef);
      }
      if (input.recordingRef !== undefined) {
        if (session.status !== 'ended') throw conflict('A recording can be added once the class is over.');
        changes.recordingRef = input.recordingRef;
      }
      const [updated] = await tx.update(liveSessions).set(changes).where(eq(liveSessions.id, session.id)).returning();
      this.realtime.emitToLive(session.id, 'live:status', statusEvent(updated!));
      return this.store.describe(tx, viewing, updated!);
    });
  }

  async start(school: SchoolContext, userId: string, courseSlug: string, sessionId: string, ip: string | null): Promise<LiveSession> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewing = await this.hosting(tx, school, userId, courseSlug);
      const session = await this.store.session(tx, viewing, sessionId, { forUpdate: true });
      if (session.status === 'live') return this.store.describe(tx, viewing, session);
      if (session.status !== 'scheduled') throw session.status === 'cancelled' ? conflict('This class was cancelled.') : isOver();
      if (session.provider === 'youtube' && !session.streamRef) throw conflict('Add the YouTube stream before going live.');
      if (session.provider === 'livekit' && !this.livekit.enabled) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'service_unavailable', "Live video in the browser isn't available right now.");
      const [started] = await tx.update(liveSessions).set({ status: 'live', startedAt: sql`now()` }).where(eq(liveSessions.id, session.id)).returning();
      if (viewing.course.status === 'published') {
        await this.outbox.add(tx, 'live.started', { sessionId: session.id, courseId: viewing.course.id, actorId: userId }, school.id);
      }
      await this.audit.record(tx, { action: 'live.started', actorId: userId, schoolId: school.id, targetType: 'live_session', targetId: session.id, ip });
      this.realtime.emitToLive(session.id, 'live:status', statusEvent(started!));
      return this.store.describe(tx, viewing, started!);
    });
  }

  async end(school: SchoolContext, userId: string, courseSlug: string, sessionId: string, ip: string | null): Promise<LiveSession> {
    const described = await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewing = await this.hosting(tx, school, userId, courseSlug);
      const session = await this.store.session(tx, viewing, sessionId, { forUpdate: true });
      if (session.status === 'ended') return this.store.describe(tx, viewing, session);
      if (session.status !== 'live') throw conflict(session.status === 'cancelled' ? 'This class was cancelled.' : "This class hasn't started.");
      const [ended] = await tx.update(liveSessions).set({ status: 'ended', endedAt: sql`now()` }).where(eq(liveSessions.id, session.id)).returning();
      await this.audit.record(tx, { action: 'live.ended', actorId: userId, schoolId: school.id, targetType: 'live_session', targetId: session.id, ip });
      this.realtime.emitToLive(session.id, 'live:status', statusEvent(ended!));
      return this.store.describe(tx, viewing, ended!);
    });
    await Promise.all([this.livekit.closeRoom(sessionId), this.store.clearFlags(sessionId)]);
    return described;
  }

  async cancel(school: SchoolContext, userId: string, courseSlug: string, sessionId: string, ip: string | null): Promise<LiveSession> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewing = await this.hosting(tx, school, userId, courseSlug);
      const session = await this.store.session(tx, viewing, sessionId, { forUpdate: true });
      if (session.status === 'cancelled') return this.store.describe(tx, viewing, session);
      if (session.status !== 'scheduled') throw conflict('A class that has started can only be ended.');
      const [cancelled] = await tx.update(liveSessions).set({ status: 'cancelled' }).where(eq(liveSessions.id, session.id)).returning();
      await this.audit.record(tx, { action: 'live.cancelled', actorId: userId, schoolId: school.id, targetType: 'live_session', targetId: session.id, ip });
      this.realtime.emitToLive(session.id, 'live:status', statusEvent(cancelled!));
      return this.store.describe(tx, viewing, cancelled!);
    });
  }

  /** Removes a class that never happened. One that started stays on record. */
  async remove(school: SchoolContext, userId: string, courseSlug: string, sessionId: string, ip: string | null): Promise<void> {
    await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewing = await this.hosting(tx, school, userId, courseSlug);
      const session = await this.store.session(tx, viewing, sessionId, { forUpdate: true });
      if (session.status !== 'scheduled' && session.status !== 'cancelled') throw conflict('A class that has started stays on record; end it instead.');
      await tx.delete(liveSessions).where(eq(liveSessions.id, session.id));
      await this.audit.record(tx, { action: 'live.deleted', actorId: userId, schoolId: school.id, targetType: 'live_session', targetId: session.id, ip, data: { title: session.title } });
    });
  }

  async messages(school: SchoolContext, userId: string, courseSlug: string, sessionId: string, query: { before?: string; limit: number }): Promise<LiveMessage[]> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewing = await this.joining(tx, school, userId, courseSlug);
      await this.store.session(tx, viewing, sessionId);
      return this.store.messages(tx, viewing, sessionId, query);
    });
  }

  async hideMessage(school: SchoolContext, userId: string, courseSlug: string, sessionId: string, messageId: string): Promise<void> {
    await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewing = await this.hosting(tx, school, userId, courseSlug);
      await this.store.session(tx, viewing, sessionId);
      const [hidden] = await tx
        .update(liveMessages)
        .set({ hiddenAt: sql`now()`, hiddenBy: userId })
        .where(and(eq(liveMessages.id, messageId), eq(liveMessages.sessionId, sessionId), isNull(liveMessages.hiddenAt)))
        .returning({ id: liveMessages.id });
      if (!hidden) {
        const [exists] = await tx.select({ id: liveMessages.id }).from(liveMessages).where(and(eq(liveMessages.id, messageId), eq(liveMessages.sessionId, sessionId)));
        if (!exists) throw notFound('This message');
        return;
      }
      this.realtime.emitToLive(sessionId, 'live:message-hidden', { sessionId, messageId });
    });
  }

  async attendance(school: SchoolContext, userId: string, courseSlug: string, sessionId: string): Promise<LiveAttendance[]> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewing = await this.hosting(tx, school, userId, courseSlug);
      await this.store.session(tx, viewing, sessionId);
      const rows = await tx
        .select({ userId: liveAttendance.userId, name: users.name, joinedAt: liveAttendance.joinedAt, lastSeenAt: liveAttendance.lastSeenAt })
        .from(liveAttendance)
        .innerJoin(users, eq(users.id, liveAttendance.userId))
        .where(eq(liveAttendance.sessionId, sessionId))
        .orderBy(asc(liveAttendance.joinedAt));
      return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString() }));
    });
  }

  /** A LiveKit token: students once the class is on, hosts from before it starts until it ends. */
  async token(school: SchoolContext, userId: string, courseSlug: string, sessionId: string): Promise<LiveKitAccess> {
    const { viewing, session, name } = await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewing = await this.joining(tx, school, userId, courseSlug);
      const session = await this.store.session(tx, viewing, sessionId);
      const [person] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
      return { viewing, session, name: person?.name ?? '' };
    });
    if (session.provider !== 'livekit') throw conflict("This class's video isn't in the browser.");
    if (!this.livekit.enabled) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'service_unavailable', "Live video in the browser isn't available right now.");
    if (session.status === 'ended' || session.status === 'cancelled') throw isOver();
    if (session.status !== 'live' && !viewing.host) throw notStarted();
    const canPublish = viewing.host || (await this.store.isSpeaker(sessionId, userId));
    return this.livekit.token(sessionId, { id: userId, name, host: viewing.host, canPublish });
  }

  /** Lets a student speak (camera and microphone), or stops them. Their hand comes down either way. */
  async setSpeaker(school: SchoolContext, userId: string, courseSlug: string, sessionId: string, studentId: string, allowed: boolean): Promise<void> {
    const viewing = await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const viewing = await this.hosting(tx, school, userId, courseSlug);
      const session = await this.store.session(tx, viewing, sessionId);
      if (session.status !== 'live') throw conflict(session.status === 'scheduled' ? "The class hasn't started yet." : 'This class is over.');
      // Only a LiveKit class carries students' microphones and cameras; elsewhere, answer them in the chat.
      if (session.provider !== 'livekit') throw conflict('Students can speak only in LiveKit classes.');
      if (allowed) {
        const [enrolled] = await tx
          .select({ userId: enrollments.userId })
          .from(enrollments)
          .where(and(eq(enrollments.courseId, viewing.course.id), eq(enrollments.userId, studentId)));
        if (!enrolled) throw notFound('This student');
      }
      return viewing;
    });
    await this.store.setFlag(sessionId, 'speakers', studentId, allowed);
    await this.store.setFlag(sessionId, 'hands', studentId, false);
    await this.livekit.setPublish(sessionId, studentId, allowed);
    this.realtime.emitToUser(studentId, 'live:speaker', { sessionId, allowed });
    await this.room.broadcastPresence(sessionId, viewing);
  }

  /** The course, if this person hosts its classes. */
  private async hosting(tx: Tx, school: SchoolContext, userId: string, courseSlug: string) {
    const viewing = await this.store.viewCourse(tx, school, userId, courseSlug);
    if (!viewing.host) throw forbidden("Only the course's editors run its classes.");
    return viewing;
  }

  /** The course, if this person may come into its classes. */
  private async joining(tx: Tx, school: SchoolContext, userId: string, courseSlug: string) {
    const viewing = await this.store.viewCourse(tx, school, userId, courseSlug);
    if (!viewing.canJoin) throw enrollmentRequired('Enroll in this course to join its live classes.');
    return viewing;
  }
}

const statusEvent = (session: SessionRecord) => ({
  sessionId: session.id,
  status: session.status,
  startedAt: session.startedAt?.toISOString() ?? null,
  endedAt: session.endedAt?.toISOString() ?? null,
});

/** Checks a new stream reference against the class's provider. */
function parseStreamRef(provider: LiveProvider, value: string | null) {
  const result = z
    .string()
    .nullable()
    .transform((ref, ctx) => normalizeStreamRef(provider, ref, ctx))
    .safeParse(value);
  if (!result.success) throw invalid('streamRef', result.error.issues[0]?.message ?? 'Check the address');
  return result.data;
}
