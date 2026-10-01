import { HttpStatus, Injectable } from '@nestjs/common';
import { COMPLETION_SHARE, type LessonProgress, PROGRESS_SEGMENT_SECONDS, type ProgressInput } from '@grand/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import type { SchoolContext } from '../common/request-context.js';
import { DatabaseService, type Tx } from '../database/database.service.js';
import { lessonProgress } from '../database/schema.js';
import { CoursesService } from '../courses/courses.service.js';
import { enrollmentRequired, type LessonRecord, LessonsService } from '../courses/lessons.service.js';
import { canWatchLesson } from '../courses/course-access.js';
import { lessonProgressDetail } from './progress.js';
import { countSegments, markSegments, segmentCount } from './segments.js';

/**
 * Records how far enrolled students get: the stretches of a video they've watched and where they
 * stopped, and which lessons they've completed. Only enrolled students have progress; previews
 * and editors looking around leave none.
 */
@Injectable()
export class ProgressService {
  constructor(
    private readonly db: DatabaseService,
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
  ) {}

  /** The player's regular report: stretches watched since the last one, and the position. */
  async record(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, input: ProgressInput): Promise<LessonProgress> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const lesson = await this.watchable(tx, school, userId, courseSlug, lessonId);
      if (lesson.kind !== 'lesson') throw new ApiException(HttpStatus.CONFLICT, 'conflict', 'Only lessons with a video record watching.');
      const row = await this.lockRow(tx, school.id, lesson, userId);

      const duration = lesson.durationSeconds ?? 0;
      const total = duration > 0 ? segmentCount(duration) : 0;
      const watched = total ? markSegments(row.watched, input.segments, total) : row.watched;
      const watchedSeconds = total ? Math.min(duration, countSegments(watched, total) * PROGRESS_SEGMENT_SECONDS) : 0;
      // An uploaded video is complete once most of it has played; others are marked by hand.
      const done = lesson.videoProvider === 'upload' && total > 0 && countSegments(watched, total) >= Math.ceil(total * COMPLETION_SHARE);
      const [updated] = await tx
        .update(lessonProgress)
        .set({
          watched,
          watchedSeconds,
          positionSeconds: Math.floor(duration ? Math.min(input.positionSeconds, duration) : input.positionSeconds),
          ...(done && !row.completedAt && { completedAt: sql`now()` }),
          // Touched even when nothing changed, so "continue where you left off" follows the latest lesson.
          updatedAt: sql`now()`,
        })
        .where(and(eq(lessonProgress.lessonId, lesson.id), eq(lessonProgress.userId, userId)))
        .returning();
      return lessonProgressDetail(lesson, updated);
    });
  }

  /**
   * Marks a lesson done by hand: one without an uploaded video (text, or a video on another
   * platform, whose player can't tell us what was watched).
   */
  async complete(school: SchoolContext, userId: string, courseSlug: string, lessonId: string): Promise<LessonProgress> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const lesson = await this.watchable(tx, school, userId, courseSlug, lessonId);
      if (lesson.kind !== 'lesson' || lesson.videoProvider === 'upload') {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'conflict',
          lesson.kind === 'quiz' ? 'A quiz is completed by passing it.' : lesson.kind === 'assignment' ? 'An assignment is completed by handing it in.' : 'This lesson completes once you have watched its video.',
        );
      }
      return lessonProgressDetail(lesson, await this.markCompleted(tx, school.id, lesson, userId));
    });
  }

  /** Sets a lesson completed for this person (passing a quiz, handing in an assignment). */
  async markCompleted(tx: Tx, schoolId: string, lesson: Pick<LessonRecord, 'id' | 'courseId'>, userId: string) {
    await this.lockRow(tx, schoolId, lesson, userId);
    const [row] = await tx
      .update(lessonProgress)
      .set({ completedAt: sql`coalesce(${lessonProgress.completedAt}, now())`, updatedAt: sql`now()` })
      .where(and(eq(lessonProgress.lessonId, lesson.id), eq(lessonProgress.userId, userId)))
      .returning();
    return row!;
  }

  /** The lesson, if this person is enrolled and may open it; editors and previews get a 403. */
  private async watchable(tx: Tx, school: SchoolContext, userId: string, courseSlug: string, lessonId: string) {
    const course = await this.courses.findVisible(tx, school, userId, courseSlug);
    const { lesson } = await this.lessons.find(tx, school, userId, course, lessonId);
    const enrolled = await this.lessons.isEnrolled(tx, course.id, userId);
    if (!enrolled || !canWatchLesson(school, userId, course, lesson, enrolled)) throw enrollmentRequired();
    return lesson;
  }

  /** This person's row for the lesson, created if needed and locked for the transaction. */
  private async lockRow(tx: Tx, schoolId: string, lesson: Pick<LessonRecord, 'id' | 'courseId'>, userId: string) {
    await tx
      .insert(lessonProgress)
      .values({ schoolId, courseId: lesson.courseId, lessonId: lesson.id, userId, watched: Buffer.alloc(0) })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(lessonProgress)
      .where(and(eq(lessonProgress.lessonId, lesson.id), eq(lessonProgress.userId, userId)))
      .for('update');
    return row!;
  }
}
