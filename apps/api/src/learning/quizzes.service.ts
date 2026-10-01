import { HttpStatus, Injectable } from '@nestjs/common';
import type { Quiz, QuizAttemptInput, QuizAttemptResult, QuizAttemptSummary, QuizDraft, QuizInput } from '@grand/contracts';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { ApiException, notFound } from '../common/api-exception.js';
import type { SchoolContext } from '../common/request-context.js';
import { DatabaseService, type Tx } from '../database/database.service.js';
import { quizAttempts, quizzes } from '../database/schema.js';
import { canWatchLesson } from '../courses/course-access.js';
import { type CourseRecord, CoursesService } from '../courses/courses.service.js';
import { enrollmentRequired, type LessonRecord, LessonsService } from '../courses/lessons.service.js';
import { AuditService } from '../events/audit.service.js';
import { ProgressService } from './progress.service.js';
import { forEditor, forTaker, gradeQuiz, storeQuestions } from './quiz-grading.js';

type QuizRecord = typeof quizzes.$inferSelect;
type AttemptRecord = typeof quizAttempts.$inferSelect;

const summary = (attempt: AttemptRecord): QuizAttemptSummary => ({
  id: attempt.id,
  score: attempt.score,
  maxScore: attempt.maxScore,
  percent: attempt.percent,
  passed: attempt.passed,
  createdAt: attempt.createdAt.toISOString(),
});

/**
 * Quizzes: their questions (written by the course's editors), and attempts, graded here so the
 * right answers never reach the browser before they've been earned.
 */
@Injectable()
export class QuizzesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
    private readonly progress: ProgressService,
    private readonly audit: AuditService,
  ) {}

  /** The quiz as its taker sees it, with their attempts so far. */
  async get(school: SchoolContext, userId: string, courseSlug: string, lessonId: string): Promise<Quiz> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const { quiz } = await this.open(tx, school, userId, courseSlug, lessonId);
      const attempts = await tx
        .select()
        .from(quizAttempts)
        .where(and(eq(quizAttempts.lessonId, quiz.lessonId), eq(quizAttempts.userId, userId)))
        .orderBy(desc(quizAttempts.createdAt))
        .limit(100);
      return {
        lessonId: quiz.lessonId,
        passPercent: quiz.passPercent,
        maxAttempts: quiz.maxAttempts,
        maxScore: quiz.questions.reduce((sum, question) => sum + question.points, 0),
        questions: quiz.questions.map(forTaker),
        attempts: attempts.map(summary),
        attemptsLeft: quiz.maxAttempts === null ? null : Math.max(0, quiz.maxAttempts - attempts.length),
        passed: attempts.some((attempt) => attempt.passed),
        bestPercent: attempts.length ? Math.max(...attempts.map((attempt) => attempt.percent)) : null,
      };
    });
  }

  /** The quiz with its answers, for the course's editors. */
  async draft(school: SchoolContext, userId: string, courseSlug: string, lessonId: string): Promise<QuizDraft> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const { quiz } = await this.editable(tx, school, userId, courseSlug, lessonId);
      return this.describeDraft(tx, quiz);
    });
  }

  /** Replaces the quiz's settings and questions. Past attempts keep their scores. */
  async save(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, input: QuizInput, ip: string | null): Promise<QuizDraft> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const { quiz } = await this.editable(tx, school, userId, courseSlug, lessonId);
      const [saved] = await tx
        .update(quizzes)
        .set({ passPercent: input.passPercent, maxAttempts: input.maxAttempts, questions: storeQuestions(input.questions) })
        .where(eq(quizzes.lessonId, quiz.lessonId))
        .returning();
      await this.audit.record(tx, {
        action: 'quiz.updated',
        actorId: userId,
        schoolId: school.id,
        targetType: 'lesson',
        targetId: quiz.lessonId,
        ip,
        data: { questions: input.questions.length },
      });
      return this.describeDraft(tx, saved!);
    });
  }

  /**
   * Grades an attempt. Only enrolled students can make one, within the attempt limit (counted
   * under a lock, so two at once can't both slip under it). Passing completes the lesson.
   */
  async attempt(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, input: QuizAttemptInput): Promise<QuizAttemptResult> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const { course, lesson, quiz } = await this.open(tx, school, userId, courseSlug, lessonId);
      if (!(await this.lessons.isEnrolled(tx, course.id, userId))) throw enrollmentRequired();
      if (quiz.questions.length === 0) throw new ApiException(HttpStatus.CONFLICT, 'conflict', "This quiz doesn't have any questions yet.");

      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`quiz:${lesson.id}:${userId}`}, 0))`);
      const [{ made } = { made: 0 }] = await tx
        .select({ made: count() })
        .from(quizAttempts)
        .where(and(eq(quizAttempts.lessonId, lesson.id), eq(quizAttempts.userId, userId)));
      if (quiz.maxAttempts !== null && made >= quiz.maxAttempts) {
        throw new ApiException(HttpStatus.FORBIDDEN, 'limit_reached', "You've used all your attempts at this quiz.");
      }

      const grade = gradeQuiz(quiz.questions, input.answers);
      const passed = grade.percent >= quiz.passPercent;
      const [attempt] = await tx
        .insert(quizAttempts)
        .values({
          schoolId: school.id,
          courseId: course.id,
          lessonId: lesson.id,
          userId,
          answers: input.answers,
          results: grade.results,
          score: grade.score,
          maxScore: grade.maxScore,
          percent: grade.percent,
          passed,
        })
        .returning();
      if (passed) await this.progress.markCompleted(tx, school.id, lesson, userId);

      const attemptsLeft = quiz.maxAttempts === null ? null : Math.max(0, quiz.maxAttempts - made - 1);
      const [{ passedBefore } = { passedBefore: 0 }] = passed
        ? [{ passedBefore: 1 }]
        : await tx
            .select({ passedBefore: count() })
            .from(quizAttempts)
            .where(and(eq(quizAttempts.lessonId, lesson.id), eq(quizAttempts.userId, userId), eq(quizAttempts.passed, true)));
      // The right answers, once they can no longer be used to pass.
      const reveal = passedBefore > 0 || attemptsLeft === 0;
      return {
        ...summary(attempt!),
        attemptsLeft,
        questions: grade.results.map((result) => {
          const question = quiz.questions.find((candidate) => candidate.id === result.questionId)!;
          return {
            ...result,
            explanation: reveal ? question.explanation || null : null,
            correctOptionIds: reveal && question.kind !== 'short' ? question.options.filter((option) => option.correct).map((option) => option.id) : null,
            acceptedAnswers: reveal && question.kind === 'short' ? question.answers : null,
          };
        }),
      };
    });
  }

  /** The quiz of a lesson this person may open. */
  private async open(tx: Tx, school: SchoolContext, userId: string, courseSlug: string, lessonId: string) {
    const course = await this.courses.findVisible(tx, school, userId, courseSlug);
    const { lesson } = await this.lessons.find(tx, school, userId, course, lessonId);
    const enrolled = await this.lessons.isEnrolled(tx, course.id, userId);
    if (!canWatchLesson(school, userId, course, lesson, enrolled)) throw enrollmentRequired();
    return { course, lesson, quiz: await this.quizOf(tx, lesson) };
  }

  private async editable(tx: Tx, school: SchoolContext, userId: string, courseSlug: string, lessonId: string): Promise<{ course: CourseRecord; quiz: QuizRecord }> {
    const course = await this.courses.findEditable(tx, school, userId, courseSlug);
    const { lesson } = await this.lessons.find(tx, school, userId, course, lessonId, { forUpdate: true });
    return { course, quiz: await this.quizOf(tx, lesson) };
  }

  private async quizOf(tx: Tx, lesson: LessonRecord): Promise<QuizRecord> {
    if (lesson.kind !== 'quiz') throw notFound('A quiz in this lesson');
    const [quiz] = await tx.select().from(quizzes).where(eq(quizzes.lessonId, lesson.id));
    if (!quiz) throw notFound('This quiz');
    return quiz;
  }

  private async describeDraft(tx: Tx, quiz: QuizRecord): Promise<QuizDraft> {
    const [{ attemptCount } = { attemptCount: 0 }] = await tx.select({ attemptCount: count() }).from(quizAttempts).where(eq(quizAttempts.lessonId, quiz.lessonId));
    return {
      lessonId: quiz.lessonId,
      passPercent: quiz.passPercent,
      maxAttempts: quiz.maxAttempts,
      questions: quiz.questions.map(forEditor),
      attemptCount,
    };
  }
}
