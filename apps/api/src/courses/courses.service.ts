import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type Course,
  type CourseModule,
  type CourseSummary,
  type CreateCourseInput,
  type LessonSummary,
  type ModuleInput,
  type OutlineInput,
  ROLE_RANK,
  type UpdateCourseInput,
} from '@grand/contracts';
import { and, asc, count, desc, eq, isNotNull, or, sql } from 'drizzle-orm';
import { ApiException, forbidden, notFound } from '../common/api-exception.js';
import type { SchoolContext } from '../common/request-context.js';
import { DatabaseService, type Tx } from '../database/database.service.js';
import { isUniqueViolation } from '../database/errors.js';
import { courseModules, courses, enrollments, lessons, mediaAssets, users } from '../database/schema.js';
import { AuditService } from '../events/audit.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { AppConfig } from '../config/app-config.js';
import { mediaKeys, StorageService } from '../storage/storage.service.js';
import { canCreateCourses, canEditCourse, canSeeCourse, canWatchLesson } from './course-access.js';
import { slugify } from './slugify.js';

export type CourseRecord = typeof courses.$inferSelect;
type LessonRecord = typeof lessons.$inferSelect;
type MediaRecord = typeof mediaAssets.$inferSelect;

const slugTaken = () =>
  new ApiException(HttpStatus.CONFLICT, 'slug_taken', 'Another course in this school uses this address.', [
    { path: 'slug', message: 'This address is taken' },
  ]);

/** A lesson as the outline shows it, with its upload's progress when it has one. */
export function toLessonSummary(lesson: LessonRecord, media: MediaRecord | null, locked: boolean): LessonSummary {
  let video: LessonSummary['video'] = null;
  if (lesson.videoProvider === 'upload' && media) {
    video = { provider: 'upload', assetId: media.id, status: media.status, progress: media.progress, error: media.error };
  } else if (lesson.videoProvider && lesson.videoProvider !== 'upload' && lesson.videoRef) {
    video = { provider: lesson.videoProvider, ref: lesson.videoRef };
  }
  return {
    id: lesson.id,
    moduleId: lesson.moduleId,
    title: lesson.title,
    summary: lesson.summary,
    status: lesson.status,
    isPreview: lesson.isPreview,
    durationSeconds: lesson.durationSeconds,
    video,
    locked,
  };
}

/** The ids of the uploaded videos among these lessons, to delete from storage with them. */
export function uploadedMedia(rows: Pick<LessonRecord, 'mediaId'>[]): string[] {
  return rows.map((row) => row.mediaId).filter((id): id is string => id !== null);
}

@Injectable()
export class CoursesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
  ) {}

  /** The course with this address, if the viewer may see it; otherwise "not found", drafts included. */
  async findVisible(tx: Tx, school: SchoolContext, userId: string, courseSlug: string): Promise<CourseRecord> {
    const [course] = await tx.select().from(courses).where(and(eq(courses.schoolId, school.id), eq(courses.slug, courseSlug)));
    if (!course || !canSeeCourse(school, userId, course)) throw notFound('This course');
    return course;
  }

  /** As findVisible, but the viewer must be able to edit it. */
  async findEditable(tx: Tx, school: SchoolContext, userId: string, courseSlug: string): Promise<CourseRecord> {
    const course = await this.findVisible(tx, school, userId, courseSlug);
    if (!canEditCourse(school, userId, course)) throw forbidden('Only the course author or a school admin can change this course.');
    return course;
  }

  /** The school's courses the viewer may see, newest first, with lesson counts and running time. */
  async catalog(school: SchoolContext, userId: string, filter: { status?: CourseRecord['status']; mine?: boolean } = {}): Promise<CourseSummary[]> {
    const rows = await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const stats = tx
        .select({
          courseId: lessons.courseId,
          published: sql<number>`count(*) filter (where ${lessons.status} = 'published')::int`.as('published'),
          total: sql<number>`count(*)::int`.as('total'),
          publishedSeconds: sql<number>`coalesce(sum(${lessons.durationSeconds}) filter (where ${lessons.status} = 'published'), 0)::int`.as('published_seconds'),
          totalSeconds: sql<number>`coalesce(sum(${lessons.durationSeconds}), 0)::int`.as('total_seconds'),
        })
        .from(lessons)
        .groupBy(lessons.courseId)
        .as('stats');

      const visibility =
        ROLE_RANK[school.role] >= ROLE_RANK.admin
          ? undefined
          : school.role === 'instructor'
            ? or(eq(courses.status, 'published'), eq(courses.createdBy, userId))
            : eq(courses.status, 'published');

      return tx
        .select({
          course: courses,
          published: stats.published,
          total: stats.total,
          publishedSeconds: stats.publishedSeconds,
          totalSeconds: stats.totalSeconds,
          enrolledAt: enrollments.createdAt,
        })
        .from(courses)
        .leftJoin(stats, eq(stats.courseId, courses.id))
        .leftJoin(enrollments, and(eq(enrollments.courseId, courses.id), eq(enrollments.userId, userId)))
        .where(
          and(
            eq(courses.schoolId, school.id),
            visibility,
            filter.status ? eq(courses.status, filter.status) : undefined,
            filter.mine ? isNotNull(enrollments.createdAt) : undefined,
          ),
        )
        .orderBy(desc(courses.publishedAt), desc(courses.createdAt))
        .limit(200);
    });

    return Promise.all(
      rows.map(async ({ course, published, total, publishedSeconds, totalSeconds, enrolledAt }) => {
        const editor = canEditCourse(school, userId, course);
        return {
          ...(await this.summaryFields(course)),
          lessonCount: (editor ? total : published) ?? 0,
          durationSeconds: (editor ? totalSeconds : publishedSeconds) ?? 0,
          enrolled: enrolledAt !== null,
        };
      }),
    );
  }

  /** One course with its outline. Viewers who can't edit see published lessons only. */
  async get(school: SchoolContext, userId: string, courseSlug: string): Promise<Course> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.findVisible(tx, school, userId, courseSlug);
      return this.describe(tx, school, userId, course);
    });
  }

  async create(school: SchoolContext, userId: string, input: CreateCourseInput, ip: string | null): Promise<Course> {
    if (!canCreateCourses(school)) throw forbidden('Only instructors, admins and the owner can create courses.');
    try {
      return await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
        const slug = input.slug ?? (await this.freeSlug(tx, school.id, slugify(input.title) || 'course'));
        const [course] = await tx
          .insert(courses)
          .values({ schoolId: school.id, slug, title: input.title, summary: input.summary ?? '', createdBy: userId })
          .returning();
        // Every course starts with one module, so lessons have somewhere to go.
        await tx.insert(courseModules).values({ schoolId: school.id, courseId: course!.id, title: 'Module 1', position: 0 });
        await this.audit.record(tx, { action: 'course.created', actorId: userId, schoolId: school.id, targetType: 'course', targetId: course!.id, ip });
        return this.describe(tx, school, userId, course!);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'courses_slug_key')) throw slugTaken();
      throw error;
    }
  }

  async update(school: SchoolContext, userId: string, courseSlug: string, input: UpdateCourseInput, ip: string | null): Promise<Course> {
    try {
      return await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
        const course = await this.findEditable(tx, school, userId, courseSlug);
        const publishing = input.status === 'published' && course.status !== 'published';
        const [updated] = await tx
          .update(courses)
          .set({
            ...input,
            ...(publishing && { publishedAt: course.publishedAt ?? sql`now()` }),
          })
          .where(eq(courses.id, course.id))
          .returning();
        if (input.status && input.status !== course.status) {
          await this.audit.record(tx, {
            action: `course.${input.status === 'published' ? 'published' : input.status === 'archived' ? 'archived' : 'unpublished'}`,
            actorId: userId,
            schoolId: school.id,
            targetType: 'course',
            targetId: course.id,
            ip,
          });
          if (publishing && !course.publishedAt) {
            await this.outbox.add(tx, 'course.published', { courseId: course.id, schoolId: school.id }, school.id);
          }
        }
        return this.describe(tx, school, userId, updated!);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'courses_slug_key')) throw slugTaken();
      throw error;
    }
  }

  /** Deletes the course, its outline and enrollments; its videos are removed from storage afterwards. */
  async remove(school: SchoolContext, userId: string, courseSlug: string, ip: string | null): Promise<void> {
    await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.findEditable(tx, school, userId, courseSlug);
      const media = uploadedMedia(await tx.select({ mediaId: lessons.mediaId }).from(lessons).where(eq(lessons.courseId, course.id)));
      await tx.delete(courses).where(eq(courses.id, course.id));
      await this.scheduleMediaDeletion(tx, school.id, media);
      await this.audit.record(tx, { action: 'course.deleted', actorId: userId, schoolId: school.id, targetType: 'course', targetId: course.id, ip, data: { title: course.title } });
    });
  }

  async addModule(school: SchoolContext, userId: string, courseSlug: string, input: ModuleInput): Promise<Course> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.findEditable(tx, school, userId, courseSlug);
      const [last] = await tx
        .select({ position: courseModules.position })
        .from(courseModules)
        .where(eq(courseModules.courseId, course.id))
        .orderBy(desc(courseModules.position))
        .limit(1);
      const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(courseModules).where(eq(courseModules.courseId, course.id));
      if (total >= 200) throw new ApiException(HttpStatus.FORBIDDEN, 'limit_reached', 'A course can have up to 200 modules.');
      await tx.insert(courseModules).values({ schoolId: school.id, courseId: course.id, title: input.title, position: (last?.position ?? -1) + 1 });
      return this.describe(tx, school, userId, course);
    });
  }

  async renameModule(school: SchoolContext, userId: string, courseSlug: string, moduleId: string, input: ModuleInput): Promise<Course> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.findEditable(tx, school, userId, courseSlug);
      const [renamed] = await tx
        .update(courseModules)
        .set({ title: input.title })
        .where(and(eq(courseModules.id, moduleId), eq(courseModules.courseId, course.id)))
        .returning({ id: courseModules.id });
      if (!renamed) throw notFound('This module');
      return this.describe(tx, school, userId, course);
    });
  }

  /** Deletes a module and its lessons. A course always keeps at least one module. */
  async removeModule(school: SchoolContext, userId: string, courseSlug: string, moduleId: string, ip: string | null): Promise<Course> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.findEditable(tx, school, userId, courseSlug);
      const modules = await tx.select({ id: courseModules.id }).from(courseModules).where(eq(courseModules.courseId, course.id));
      if (!modules.some((module) => module.id === moduleId)) throw notFound('This module');
      if (modules.length === 1) throw new ApiException(HttpStatus.CONFLICT, 'conflict', 'A course needs at least one module.');
      const media = uploadedMedia(await tx.select({ mediaId: lessons.mediaId }).from(lessons).where(eq(lessons.moduleId, moduleId)));
      await tx.delete(courseModules).where(eq(courseModules.id, moduleId));
      await this.scheduleMediaDeletion(tx, school.id, media);
      await this.audit.record(tx, { action: 'course.module_deleted', actorId: userId, schoolId: school.id, targetType: 'course', targetId: course.id, ip });
      return this.describe(tx, school, userId, course);
    });
  }

  /**
   * Puts modules and lessons in a new order, moving lessons between modules as listed. The
   * request must list every module and lesson of the course exactly once. Positions are unique
   * per module, checked when the transaction commits, so any reshuffle works in one go.
   */
  async reorder(school: SchoolContext, userId: string, courseSlug: string, input: OutlineInput): Promise<Course> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.findEditable(tx, school, userId, courseSlug);
      const moduleRows = await tx.select({ id: courseModules.id }).from(courseModules).where(eq(courseModules.courseId, course.id)).for('update');
      const lessonRows = await tx.select({ id: lessons.id }).from(lessons).where(eq(lessons.courseId, course.id)).for('update');
      const listedModules = input.modules.map((module) => module.id);
      const listedLessons = input.modules.flatMap((module) => module.lessonIds);
      if (!sameSet(listedModules, moduleRows.map((row) => row.id)) || !sameSet(listedLessons, lessonRows.map((row) => row.id))) {
        throw new ApiException(HttpStatus.CONFLICT, 'conflict', 'The course changed while you were editing. Reload to see the latest outline.');
      }
      for (const [modulePosition, module] of input.modules.entries()) {
        await tx.update(courseModules).set({ position: modulePosition }).where(eq(courseModules.id, module.id));
        for (const [lessonPosition, lessonId] of module.lessonIds.entries()) {
          await tx.update(lessons).set({ moduleId: module.id, position: lessonPosition }).where(eq(lessons.id, lessonId));
        }
      }
      return this.describe(tx, school, userId, course);
    });
  }

  /** Queues the removal of these videos' files and rows (the worker does it). */
  async scheduleMediaDeletion(tx: Tx, schoolId: string, mediaIds: string[]) {
    for (const assetId of mediaIds) await this.outbox.add(tx, 'media.deleted', { assetId, schoolId }, schoolId);
  }

  /** Builds the full course view for this viewer inside an open transaction. */
  async describe(tx: Tx, school: SchoolContext, userId: string, course: CourseRecord): Promise<Course> {
    const editor = canEditCourse(school, userId, course);
    const [moduleRows, lessonRows, [author], [enrollment], [{ enrolledCount } = { enrolledCount: 0 }]] = await Promise.all([
      tx.select().from(courseModules).where(eq(courseModules.courseId, course.id)).orderBy(asc(courseModules.position)),
      tx
        .select({ lesson: lessons, media: mediaAssets })
        .from(lessons)
        .leftJoin(mediaAssets, eq(mediaAssets.id, lessons.mediaId))
        .where(and(eq(lessons.courseId, course.id), editor ? undefined : eq(lessons.status, 'published')))
        .orderBy(asc(lessons.position)),
      course.createdBy ? tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, course.createdBy)) : Promise.resolve([]),
      tx.select({ at: enrollments.createdAt }).from(enrollments).where(and(eq(enrollments.courseId, course.id), eq(enrollments.userId, userId))),
      tx.select({ enrolledCount: count() }).from(enrollments).where(eq(enrollments.courseId, course.id)),
    ]);
    const enrolled = enrollment !== undefined;
    const modules: CourseModule[] = moduleRows.map((module) => ({
      id: module.id,
      title: module.title,
      lessons: lessonRows
        .filter(({ lesson }) => lesson.moduleId === module.id)
        .map(({ lesson, media }) => toLessonSummary(lesson, media, !canWatchLesson(school, userId, course, lesson, enrolled))),
    }));
    // Editors see every module; others don't see modules that have nothing published yet.
    const visibleModules = editor ? modules : modules.filter((module) => module.lessons.length > 0);
    const allLessons = visibleModules.flatMap((module) => module.lessons);
    return {
      ...(await this.summaryFields(course)),
      lessonCount: allLessons.length,
      durationSeconds: allLessons.reduce((sum, lesson) => sum + (lesson.durationSeconds ?? 0), 0),
      enrolled,
      description: course.description,
      createdBy: author ?? null,
      enrollmentCount: enrolledCount,
      canEdit: editor,
      modules: visibleModules,
    };
  }

  private async summaryFields(course: CourseRecord) {
    let coverUrl: string | null = null;
    if (course.coverMediaId && this.storage.enabled) {
      coverUrl = (await this.storage.signedGet(mediaKeys(course.schoolId, course.coverMediaId).poster, this.config.media.urlTtlSeconds)).url;
    }
    return {
      id: course.id,
      slug: course.slug,
      title: course.title,
      summary: course.summary,
      status: course.status,
      coverUrl,
      createdAt: course.createdAt.toISOString(),
      publishedAt: course.publishedAt?.toISOString() ?? null,
    };
  }

  /** `base`, or `base-2`, `base-3`… whichever this school doesn't use yet. */
  private async freeSlug(tx: Tx, schoolId: string, base: string): Promise<string> {
    const stem = base.length >= 3 ? base.slice(0, 55) : `${base}-course`.slice(0, 55);
    const taken = new Set(
      (await tx.select({ slug: courses.slug }).from(courses).where(and(eq(courses.schoolId, schoolId), or(eq(courses.slug, stem), sql`${courses.slug} like ${`${stem}-%`}`)))).map(
        (row) => row.slug,
      ),
    );
    if (!taken.has(stem)) return stem;
    for (let suffix = 2; ; suffix++) if (!taken.has(`${stem}-${suffix}`)) return `${stem}-${suffix}`;
  }
}

function sameSet(listed: string[], actual: string[]) {
  return listed.length === actual.length && new Set(listed).size === listed.length && actual.every((id) => listed.includes(id));
}

