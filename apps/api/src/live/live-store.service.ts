import { Injectable } from '@nestjs/common';
import { ROLE_RANK, type Role } from '@grand/contracts';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { notFound } from '../common/api-exception.js';
import type { SchoolContext } from '../common/request-context.js';
import { DatabaseService, type Tx } from '../database/database.service.js';
import { courses, liveAttendance, liveMessages, liveSessions, memberships, schools, users } from '../database/schema.js';
import { canEditCourse, canSeeCourse } from '../courses/course-access.js';
import { type CourseRecord, CoursesService } from '../courses/courses.service.js';
import { LessonsService } from '../courses/lessons.service.js';
import { RedisService } from '../redis/redis.service.js';
import { type MessageRecord, type SessionRecord, toMessage, toSession, type Viewing } from './live-access.js';

/** Hands and speakers last as long as a class could; nothing about a class outlives a day. */
const STATE_TTL_SECONDS = 24 * 3600;

/**
 * Where live classes are read and kept: who may see a class and in what role, its messages and
 * attendance (Postgres), and the passing state of a class in progress, raised hands and who may
 * speak (Redis).
 */
@Injectable()
export class LiveStore {
  constructor(
    private readonly db: DatabaseService,
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
    private readonly redis: RedisService,
  ) {}

  /** A course, and how this person relates to it. */
  async viewCourse(tx: Tx, school: SchoolContext, userId: string, courseSlug: string): Promise<Viewing> {
    const course = await this.courses.findVisible(tx, school, userId, courseSlug);
    return this.viewing(tx, school, userId, course);
  }

  async viewing(tx: Tx, school: SchoolContext, userId: string, course: CourseRecord): Promise<Viewing> {
    const host = canEditCourse(school, userId, course);
    const enrolled = await this.lessons.isEnrolled(tx, course.id, userId);
    return { school, userId, course, host, enrolled, canJoin: host || (enrolled && course.status === 'published') };
  }

  /** A class of this course. */
  async session(tx: Tx, viewing: Viewing, sessionId: string, { forUpdate = false } = {}): Promise<SessionRecord> {
    const query = tx
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.id, sessionId), eq(liveSessions.courseId, viewing.course.id)));
    const [session] = forUpdate ? await query.for('update') : await query;
    if (!session) throw notFound('This class');
    return session;
  }

  /**
   * For the live connection, which knows a class's id but not its school: the school (acting for
   * it from here on), the person's role there, the class and its course. Null when any of it is
   * missing or out of reach, so the caller can refuse without saying why.
   */
  async byId(userId: string, sessionId: string): Promise<{ viewing: Viewing; session: SessionRecord } | null> {
    const schoolId = await this.schoolOf(userId, sql`app.live_session_school(${sessionId}::uuid)`);
    if (!schoolId) return null;
    return this.db.transaction({ userId, schoolId }, async (tx) => {
      const school = await this.schoolContext(tx, userId, schoolId);
      if (!school) return null;
      const [session] = await tx.select().from(liveSessions).where(eq(liveSessions.id, sessionId));
      if (!session) return null;
      const [course] = await tx.select().from(courses).where(eq(courses.id, session.courseId));
      if (!course || !canSeeCourse(school, userId, course)) return null;
      return { viewing: await this.viewing(tx, school, userId, course), session };
    });
  }

  /** As byId, for a course: the person, if they may read its discussions (an editor, or enrolled). */
  async courseById(userId: string, courseId: string): Promise<Viewing | null> {
    const schoolId = await this.schoolOf(userId, sql`app.course_school(${courseId}::uuid)`);
    if (!schoolId) return null;
    return this.db.transaction({ userId, schoolId }, async (tx) => {
      const school = await this.schoolContext(tx, userId, schoolId);
      if (!school) return null;
      const [course] = await tx.select().from(courses).where(eq(courses.id, courseId));
      if (!course || !canSeeCourse(school, userId, course)) return null;
      return this.viewing(tx, school, userId, course);
    });
  }

  private async schoolOf(userId: string, lookup: ReturnType<typeof sql>): Promise<string | null> {
    const [row] = await this.db.transaction({ userId }, (tx) => tx.execute<{ school_id: string | null }>(sql`select ${lookup} as school_id`));
    return row?.school_id ?? null;
  }

  private async schoolContext(tx: Tx, userId: string, schoolId: string): Promise<SchoolContext | null> {
    const [row] = await tx
      .select({ school: schools, role: memberships.role })
      .from(schools)
      .innerJoin(memberships, and(eq(memberships.schoolId, schools.id), eq(memberships.userId, userId)))
      .where(eq(schools.id, schoolId));
    if (!row) return null;
    return { id: row.school.id, slug: row.school.slug, name: row.school.name, createdAt: row.school.createdAt, role: row.role };
  }

  /** Everything the class's page shows about it. */
  async describe(tx: Tx, viewing: Viewing, session: SessionRecord) {
    const [hostUser] = session.createdBy ? await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, session.createdBy)) : [];
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(liveAttendance)
      .where(eq(liveAttendance.sessionId, session.id));
    return toSession(session, viewing, { hostUser: hostUser ?? null, attendeeCount: count });
  }

  /** Many classes at once, as describe() would show each. */
  async describeMany(tx: Tx, rows: { session: SessionRecord; viewing: Viewing }[]) {
    if (!rows.length) return [];
    const hostIds = [...new Set(rows.map((row) => row.session.createdBy).filter((id): id is string => Boolean(id)))];
    const hosts = hostIds.length ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, hostIds)) : [];
    const counts = await tx
      .select({ sessionId: liveAttendance.sessionId, count: sql<number>`count(*)::int` })
      .from(liveAttendance)
      .where(inArray(liveAttendance.sessionId, rows.map((row) => row.session.id)))
      .groupBy(liveAttendance.sessionId);
    const hostById = new Map(hosts.map((host) => [host.id, host]));
    const countById = new Map(counts.map((count) => [count.sessionId, count.count]));
    return rows.map(({ session, viewing }) =>
      toSession(session, viewing, { hostUser: (session.createdBy && hostById.get(session.createdBy)) || null, attendeeCount: countById.get(session.id) ?? 0 }),
    );
  }

  /** The latest messages before `before` (an id), returned oldest first. */
  async messages(tx: Tx, viewing: Viewing, sessionId: string, { before, limit }: { before?: string; limit: number }) {
    let beforeAt: Date | null = null;
    if (before) {
      const [anchor] = await tx.select({ createdAt: liveMessages.createdAt }).from(liveMessages).where(and(eq(liveMessages.id, before), eq(liveMessages.sessionId, sessionId)));
      if (!anchor) throw notFound('This message');
      beforeAt = anchor.createdAt;
    }
    const rows = await tx
      .select()
      .from(liveMessages)
      .where(and(eq(liveMessages.sessionId, sessionId), beforeAt ? lt(liveMessages.createdAt, beforeAt) : undefined))
      .orderBy(desc(liveMessages.createdAt), desc(liveMessages.id))
      .limit(limit);
    return this.toMessages(tx, viewing, rows.reverse());
  }

  async toMessages(tx: Tx, viewing: Viewing, rows: MessageRecord[]) {
    const authors = await this.people(tx, viewing, [...new Set(rows.map((row) => row.userId).filter((id): id is string => Boolean(id)))]);
    return rows.map((row) => toMessage(row, (row.userId && authors.get(row.userId)) || null, viewing.host));
  }

  /** Names, and whether each person hosts this course's classes. */
  async people(tx: Tx, viewing: Viewing, userIds: string[]): Promise<Map<string, { name: string; host: boolean }>> {
    if (!userIds.length) return new Map();
    const rows = await tx
      .select({ id: users.id, name: users.name, role: memberships.role })
      .from(users)
      .leftJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.schoolId, viewing.school.id)))
      .where(inArray(users.id, userIds));
    return new Map(rows.map((row) => [row.id, { name: row.name, host: isHost(row.role, row.id, viewing.course) }]));
  }

  async recordAttendance(tx: Tx, viewing: Viewing, sessionId: string) {
    await tx
      .insert(liveAttendance)
      .values({ schoolId: viewing.school.id, sessionId, userId: viewing.userId })
      .onConflictDoUpdate({ target: [liveAttendance.sessionId, liveAttendance.userId], set: { lastSeenAt: sql`now()` } });
  }

  // Raised hands and speakers (Redis) --------------------------------------------------------------

  private key = (sessionId: string, what: 'hands' | 'speakers') => `grand:live:${sessionId}:${what}`;

  async setFlag(sessionId: string, what: 'hands' | 'speakers', userId: string, on: boolean) {
    const key = this.key(sessionId, what);
    if (on) await this.redis.client.multi().sadd(key, userId).expire(key, STATE_TTL_SECONDS).exec();
    else await this.redis.client.srem(key, userId);
  }

  async flags(sessionId: string): Promise<{ hands: Set<string>; speakers: Set<string> }> {
    const [hands, speakers] = await Promise.all([this.redis.client.smembers(this.key(sessionId, 'hands')), this.redis.client.smembers(this.key(sessionId, 'speakers'))]);
    return { hands: new Set(hands), speakers: new Set(speakers) };
  }

  async isSpeaker(sessionId: string, userId: string) {
    return (await this.redis.client.sismember(this.key(sessionId, 'speakers'), userId)) === 1;
  }

  async clearFlags(sessionId: string) {
    await this.redis.client.del(this.key(sessionId, 'hands'), this.key(sessionId, 'speakers'));
  }
}

/** Hosts are the course's editors: admins and the owner, and the instructor who wrote it. */
export const isHost = (role: Role | null, userId: string, course: Pick<CourseRecord, 'createdBy'>) =>
  role !== null && (ROLE_RANK[role] >= ROLE_RANK.admin || (role === 'instructor' && course.createdBy === userId));
