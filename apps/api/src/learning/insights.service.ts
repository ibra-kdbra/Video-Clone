import { Injectable } from '@nestjs/common';
import type { CourseInsights, LessonInsight, LessonInsightsDetail } from '@grand/contracts';
import { PROGRESS_SEGMENT_SECONDS } from '@grand/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { SchoolContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { assignments, assignmentSubmissions, courseModules, enrollments, lessonProgress, lessons, quizAttempts, quizzes } from '../database/schema.js';
import { CoursesService } from '../courses/courses.service.js';
import { LessonsService } from '../courses/lessons.service.js';
import { hasSegment, segmentCount } from './segments.js';

const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

/**
 * What a course's editors learn about how it's going: who's active, how far students get, where
 * they stop watching, which questions trip them up, and how assignments are going. Only enrolled
 * students count; editors trying things out don't.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
  ) {}

  async course(school: SchoolContext, userId: string, courseSlug: string): Promise<CourseInsights> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.courses.findEditable(tx, school, userId, courseSlug);
      const enrolledIn = and(eq(enrollments.courseId, course.id));
      const [lessonRows, students, progressRows, attemptRows, submissionRows] = await Promise.all([
        tx
          .select({ lesson: lessons, moduleTitle: courseModules.title, maxPoints: assignments.maxPoints })
          .from(lessons)
          .innerJoin(courseModules, eq(courseModules.id, lessons.moduleId))
          .leftJoin(assignments, eq(assignments.lessonId, lessons.id))
          .where(eq(lessons.courseId, course.id))
          .orderBy(asc(courseModules.position), asc(lessons.position)),
        tx.select({ userId: enrollments.userId }).from(enrollments).where(enrolledIn),
        tx
          .select({ lessonId: lessonProgress.lessonId, userId: lessonProgress.userId, completedAt: lessonProgress.completedAt, watchedSeconds: lessonProgress.watchedSeconds, updatedAt: lessonProgress.updatedAt })
          .from(lessonProgress)
          .innerJoin(enrollments, and(eq(enrollments.courseId, lessonProgress.courseId), eq(enrollments.userId, lessonProgress.userId)))
          .where(eq(lessonProgress.courseId, course.id)),
        tx
          .select({
            lessonId: quizAttempts.lessonId,
            userId: quizAttempts.userId,
            attempts: sql<number>`count(*)::int`,
            best: sql<number>`max(${quizAttempts.percent})::int`,
            passed: sql<boolean>`bool_or(${quizAttempts.passed})`,
          })
          .from(quizAttempts)
          .innerJoin(enrollments, and(eq(enrollments.courseId, quizAttempts.courseId), eq(enrollments.userId, quizAttempts.userId)))
          .where(eq(quizAttempts.courseId, course.id))
          .groupBy(quizAttempts.lessonId, quizAttempts.userId),
        tx
          .select({ lessonId: assignmentSubmissions.lessonId, status: assignmentSubmissions.status, grade: assignmentSubmissions.grade })
          .from(assignmentSubmissions)
          .innerJoin(enrollments, and(eq(enrollments.courseId, assignmentSubmissions.courseId), eq(enrollments.userId, assignmentSubmissions.userId)))
          .where(and(eq(assignmentSubmissions.courseId, course.id), sql`${assignmentSubmissions.status} <> 'draft'`)),
      ]);

      const published = new Set(lessonRows.filter(({ lesson }) => lesson.status === 'published').map(({ lesson }) => lesson.id));
      const completedByUser = new Map<string, number>();
      for (const row of progressRows) {
        if (row.completedAt && published.has(row.lessonId)) completedByUser.set(row.userId, (completedByUser.get(row.userId) ?? 0) + 1);
      }
      const weekAgo = Date.now() - 7 * 86_400_000;

      const insights: LessonInsight[] = lessonRows.map(({ lesson, moduleTitle, maxPoints }) => {
        const rows = progressRows.filter((row) => row.lessonId === lesson.id);
        const completed = rows.filter((row) => row.completedAt).length;
        const watched =
          lesson.kind === 'lesson' && lesson.videoProvider === 'upload' && lesson.durationSeconds
            ? average(rows.map((row) => Math.min(100, (row.watchedSeconds / lesson.durationSeconds!) * 100)))
            : null;
        const attempts = attemptRows.filter((row) => row.lessonId === lesson.id);
        const submissions = submissionRows.filter((row) => row.lessonId === lesson.id);
        const grades = submissions.filter((row) => row.status === 'graded' && row.grade !== null).map((row) => row.grade!);
        return {
          lessonId: lesson.id,
          moduleTitle,
          title: lesson.title,
          kind: lesson.kind,
          started: rows.length,
          completed,
          completionRate: rate(completed, students.length),
          averageWatchedPercent: watched === null ? null : Math.round(watched),
          quiz:
            lesson.kind === 'quiz'
              ? {
                  students: attempts.length,
                  attempts: attempts.reduce((sum, row) => sum + row.attempts, 0),
                  passRate: rate(attempts.filter((row) => row.passed).length, attempts.length),
                  averageBestPercent: Math.round(average(attempts.map((row) => row.best)) ?? 0),
                }
              : null,
          assignment:
            lesson.kind === 'assignment'
              ? {
                  submitted: submissions.length,
                  graded: grades.length,
                  averageGrade: grades.length ? Math.round(average(grades)! * 10) / 10 : null,
                  maxPoints: maxPoints ?? 100,
                }
              : null,
        };
      });

      return {
        enrolled: students.length,
        activeLast7Days: new Set(progressRows.filter((row) => row.updatedAt.getTime() >= weekAgo).map((row) => row.userId)).size,
        completedCourse: published.size ? students.filter((student) => (completedByUser.get(student.userId) ?? 0) >= published.size).length : 0,
        averagePercent: published.size
          ? Math.round(average(students.map((student) => ((completedByUser.get(student.userId) ?? 0) / published.size) * 100)) ?? 0)
          : 0,
        lessons: insights,
      };
    });
  }

  /** Where students stop watching a video, or how each question of a quiz is answered. */
  async lesson(school: SchoolContext, userId: string, courseSlug: string, lessonId: string): Promise<LessonInsightsDetail> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.courses.findEditable(tx, school, userId, courseSlug);
      const { lesson } = await this.lessons.find(tx, school, userId, course, lessonId);
      const detail: LessonInsightsDetail = { lessonId: lesson.id, kind: lesson.kind, retention: null, questions: null };

      if (lesson.kind === 'lesson' && lesson.videoProvider === 'upload' && lesson.durationSeconds) {
        const total = segmentCount(lesson.durationSeconds);
        const rows = await tx
          .select({ watched: lessonProgress.watched })
          .from(lessonProgress)
          .innerJoin(enrollments, and(eq(enrollments.courseId, lessonProgress.courseId), eq(enrollments.userId, lessonProgress.userId)))
          .where(eq(lessonProgress.lessonId, lesson.id));
        const counts = new Array<number>(total).fill(0);
        let viewers = 0;
        for (const { watched } of rows) {
          let any = false;
          for (let segment = 0; segment < total; segment++) {
            if (hasSegment(watched, segment)) {
              counts[segment]!++;
              any = true;
            }
          }
          if (any) viewers++;
        }
        detail.retention = { segmentSeconds: PROGRESS_SEGMENT_SECONDS, viewers, counts };
      }

      if (lesson.kind === 'quiz') {
        const [[quiz], attempts] = await Promise.all([
          tx.select({ questions: quizzes.questions }).from(quizzes).where(eq(quizzes.lessonId, lesson.id)),
          tx
            .select({ results: quizAttempts.results })
            .from(quizAttempts)
            .innerJoin(enrollments, and(eq(enrollments.courseId, quizAttempts.courseId), eq(enrollments.userId, quizAttempts.userId)))
            .where(eq(quizAttempts.lessonId, lesson.id)),
        ]);
        detail.questions = (quiz?.questions ?? []).map((question) => {
          const marks = attempts.flatMap((attempt) => attempt.results.filter((result) => result.questionId === question.id));
          return { id: question.id, prompt: question.prompt, answered: marks.length, correctRate: rate(marks.filter((mark) => mark.correct).length, marks.length) };
        });
      }
      return detail;
    });
  }
}
