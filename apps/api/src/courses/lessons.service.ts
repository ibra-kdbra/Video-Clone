import { HttpStatus, Injectable } from '@nestjs/common';
import type { CreateLessonInput, Enrollment, Lesson, LessonSummary, UpdateLessonInput } from '@grand/contracts';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { ApiException, notFound } from '../common/api-exception.js';
import type { SchoolContext } from '../common/request-context.js';
import { DatabaseService, type Tx } from '../database/database.service.js';
import { courseModules, enrollments, lessons, mediaAssets, users } from '../database/schema.js';
import { AuditService } from '../events/audit.service.js';
import { canEditCourse, canWatchLesson } from './course-access.js';
import { type CourseRecord, CoursesService, toLessonSummary } from './courses.service.js';

export type LessonRecord = typeof lessons.$inferSelect;

export const enrollmentRequired = () =>
  new ApiException(HttpStatus.FORBIDDEN, 'enrollment_required', 'Enroll in this course to watch this lesson.');

@Injectable()
export class LessonsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly courses: CoursesService,
    private readonly audit: AuditService,
  ) {}

  /** The lesson, if it belongs to the course and the viewer may see it in the outline. */
  async find(tx: Tx, school: SchoolContext, userId: string, course: CourseRecord, lessonId: string, { forUpdate = false } = {}) {
    const query = tx
      .select({ lesson: lessons, media: mediaAssets })
      .from(lessons)
      .leftJoin(mediaAssets, eq(mediaAssets.id, lessons.mediaId))
      .where(and(eq(lessons.id, lessonId), eq(lessons.courseId, course.id)));
    const [row] = forUpdate ? await query.for('update', { of: lessons }) : await query;
    if (!row || (row.lesson.status !== 'published' && !canEditCourse(school, userId, course))) throw notFound('This lesson');
    return row;
  }

  async isEnrolled(tx: Tx, courseId: string, userId: string) {
    const [row] = await tx.select({ at: enrollments.createdAt }).from(enrollments).where(and(eq(enrollments.courseId, courseId), eq(enrollments.userId, userId)));
    return row !== undefined;
  }

  async create(school: SchoolContext, userId: string, courseSlug: string, input: CreateLessonInput, ip: string | null): Promise<LessonSummary> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.courses.findEditable(tx, school, userId, courseSlug);
      const [module] = await tx
        .select({ id: courseModules.id })
        .from(courseModules)
        .where(and(eq(courseModules.id, input.moduleId), eq(courseModules.courseId, course.id)))
        .for('update');
      if (!module) throw notFound('This module');
      const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(lessons).where(eq(lessons.courseId, course.id));
      if (total >= 500) throw new ApiException(HttpStatus.FORBIDDEN, 'limit_reached', 'A course can have up to 500 lessons.');
      const [last] = await tx.select({ position: lessons.position }).from(lessons).where(eq(lessons.moduleId, module.id)).orderBy(desc(lessons.position)).limit(1);
      const [lesson] = await tx
        .insert(lessons)
        .values({ schoolId: school.id, courseId: course.id, moduleId: module.id, title: input.title, position: (last?.position ?? -1) + 1, createdBy: userId })
        .returning();
      await this.audit.record(tx, { action: 'lesson.created', actorId: userId, schoolId: school.id, targetType: 'lesson', targetId: lesson!.id, ip });
      return toLessonSummary(lesson!, null, false);
    });
  }

  /** A lesson with its notes and neighbours. Locked lessons (not enrolled) are refused. */
  async get(school: SchoolContext, userId: string, courseSlug: string, lessonId: string): Promise<Lesson> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.courses.findVisible(tx, school, userId, courseSlug);
      const { lesson, media } = await this.find(tx, school, userId, course, lessonId);
      const enrolled = await this.isEnrolled(tx, course.id, userId);
      if (!canWatchLesson(school, userId, course, lesson, enrolled)) throw enrollmentRequired();
      return this.describe(tx, school, userId, course, lesson, media, enrolled);
    });
  }

  async update(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, input: UpdateLessonInput, ip: string | null): Promise<Lesson> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.courses.findEditable(tx, school, userId, courseSlug);
      const { lesson } = await this.find(tx, school, userId, course, lessonId, { forUpdate: true });
      const { video, ...fields } = input;
      const changes: Partial<LessonRecord> = { ...fields };
      if (input.status === 'published' && lesson.status !== 'published' && !lesson.publishedAt) changes.publishedAt = new Date();

      if (video !== undefined) {
        // Replacing or removing an uploaded video deletes its files once nothing points at them.
        const detached = lesson.mediaId;
        changes.mediaId = null;
        changes.videoProvider = video?.provider ?? null;
        changes.videoRef = video?.ref ?? null;
        changes.durationSeconds = video?.durationSeconds ?? null;
        const [updated] = await tx.update(lessons).set(changes).where(eq(lessons.id, lesson.id)).returning();
        if (detached) await this.courses.scheduleMediaDeletion(tx, school.id, [detached]);
        await this.audit.record(tx, {
          action: 'lesson.video_changed',
          actorId: userId,
          schoolId: school.id,
          targetType: 'lesson',
          targetId: lesson.id,
          ip,
          data: { provider: video?.provider ?? null },
        });
        return this.describe(tx, school, userId, course, updated!, null, false);
      }

      const [updated] = await tx.update(lessons).set(changes).where(eq(lessons.id, lesson.id)).returning();
      const [media] = updated!.mediaId ? await tx.select().from(mediaAssets).where(eq(mediaAssets.id, updated!.mediaId)) : [];
      return this.describe(tx, school, userId, course, updated!, media ?? null, false);
    });
  }

  async remove(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, ip: string | null): Promise<void> {
    await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.courses.findEditable(tx, school, userId, courseSlug);
      const { lesson } = await this.find(tx, school, userId, course, lessonId, { forUpdate: true });
      await tx.delete(lessons).where(eq(lessons.id, lesson.id));
      if (lesson.mediaId) await this.courses.scheduleMediaDeletion(tx, school.id, [lesson.mediaId]);
      await this.audit.record(tx, { action: 'lesson.deleted', actorId: userId, schoolId: school.id, targetType: 'lesson', targetId: lesson.id, ip, data: { title: lesson.title } });
    });
  }

  /** Any member can enroll in a published course. Enrolling twice is harmless. */
  async enroll(school: SchoolContext, userId: string, courseSlug: string): Promise<void> {
    await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.courses.findVisible(tx, school, userId, courseSlug);
      if (course.status !== 'published') throw new ApiException(HttpStatus.CONFLICT, 'conflict', "This course isn't open for enrollment yet.");
      await tx.insert(enrollments).values({ schoolId: school.id, courseId: course.id, userId }).onConflictDoNothing();
    });
  }

  async unenroll(school: SchoolContext, userId: string, courseSlug: string): Promise<void> {
    await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.courses.findVisible(tx, school, userId, courseSlug);
      await tx.delete(enrollments).where(and(eq(enrollments.courseId, course.id), eq(enrollments.userId, userId)));
    });
  }

  /** Who is enrolled, newest first (the course's editors only). */
  async enrollments(school: SchoolContext, userId: string, courseSlug: string): Promise<Enrollment[]> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.courses.findEditable(tx, school, userId, courseSlug);
      const rows = await tx
        .select({ userId: enrollments.userId, name: users.name, email: users.email, enrolledAt: enrollments.createdAt })
        .from(enrollments)
        .innerJoin(users, eq(users.id, enrollments.userId))
        .where(eq(enrollments.courseId, course.id))
        .orderBy(desc(enrollments.createdAt))
        .limit(1000);
      return rows.map((row) => ({ ...row, enrolledAt: row.enrolledAt.toISOString() }));
    });
  }

  /** The lesson with its neighbours in outline order, among the lessons this viewer can see. */
  async describe(
    tx: Tx,
    school: SchoolContext,
    userId: string,
    course: CourseRecord,
    lesson: LessonRecord,
    media: typeof mediaAssets.$inferSelect | null,
    enrolled: boolean,
  ): Promise<Lesson> {
    const editor = canEditCourse(school, userId, course);
    const order = await tx
      .select({ id: lessons.id, title: lessons.title })
      .from(lessons)
      .innerJoin(courseModules, eq(courseModules.id, lessons.moduleId))
      .where(and(eq(lessons.courseId, course.id), editor ? undefined : eq(lessons.status, 'published')))
      .orderBy(asc(courseModules.position), asc(lessons.position), sql`${lessons.id}`);
    const index = order.findIndex((row) => row.id === lesson.id);
    return {
      ...toLessonSummary(lesson, media, !canWatchLesson(school, userId, course, lesson, enrolled || editor)),
      courseId: course.id,
      notes: lesson.notes,
      previous: index > 0 ? order[index - 1]! : null,
      next: index >= 0 && index < order.length - 1 ? order[index + 1]! : null,
    };
  }
}
