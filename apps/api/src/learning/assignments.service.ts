import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type Assignment,
  type AssignmentInput,
  type GradeInput,
  MAX_SUBMISSION_FILES,
  type Submission,
  type SubmissionFileInput,
  type SubmissionInput,
  type SubmissionSummary,
  type SubmissionUploadTicket,
} from '@grand/contracts';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { ApiException, notFound } from '../common/api-exception.js';
import type { SchoolContext } from '../common/request-context.js';
import { DatabaseService, type Tx } from '../database/database.service.js';
import { assignments, assignmentSubmissions, submissionFiles, users } from '../database/schema.js';
import { canEditCourse, canWatchLesson } from '../courses/course-access.js';
import { type CourseRecord, CoursesService } from '../courses/courses.service.js';
import { enrollmentRequired, type LessonRecord, LessonsService } from '../courses/lessons.service.js';
import { AuditService } from '../events/audit.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { addUsedQuota, releaseQuota, reserveQuota } from '../storage/quota.js';
import { StorageService, submissionFileKey } from '../storage/storage.service.js';
import { ProgressService } from './progress.service.js';

type AssignmentRecord = typeof assignments.$inferSelect;
type SubmissionRecord = typeof assignmentSubmissions.$inferSelect;
type FileRecord = typeof submissionFiles.$inferSelect;

/** Upload and download addresses for submission files last this long. */
const FILE_URL_TTL_SECONDS = 15 * 60;

const editableStatuses = new Set<SubmissionRecord['status']>(['draft', 'returned']);
const notEditable = () =>
  new ApiException(HttpStatus.CONFLICT, 'conflict', 'This submission has been handed in. It can be changed again if it is returned to you.');

/**
 * Assignments: their settings, each student's submission (a draft until handed in, then graded
 * or returned for another try), the files that go with it, and grading by the course's editors.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
    private readonly progress: ProgressService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** The assignment, with the viewer's own submission, and counts for its editors. */
  async get(school: SchoolContext, userId: string, courseSlug: string, lessonId: string): Promise<Assignment> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const { course, assignment } = await this.open(tx, school, userId, courseSlug, lessonId);
      return this.describe(tx, school, userId, course, assignment);
    });
  }

  async configure(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, input: AssignmentInput): Promise<Assignment> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.courses.findEditable(tx, school, userId, courseSlug);
      const { lesson } = await this.lessons.find(tx, school, userId, course, lessonId, { forUpdate: true });
      const assignment = await this.assignmentOf(tx, lesson);
      const [saved] = await tx
        .update(assignments)
        .set({ maxPoints: input.maxPoints, allowText: input.allowText, allowFiles: input.allowFiles, dueAt: input.dueAt ? new Date(input.dueAt) : null })
        .where(eq(assignments.lessonId, assignment.lessonId))
        .returning();
      return this.describe(tx, school, userId, course, saved!);
    });
  }

  /** Saves the student's written answer, starting their submission if needed. */
  async saveDraft(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, input: SubmissionInput): Promise<Submission> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const { assignment, submission } = await this.ownSubmission(tx, school, userId, courseSlug, lessonId);
      if (!editableStatuses.has(submission.status)) throw notEditable();
      if (input.body && !assignment.allowText) throw new ApiException(HttpStatus.BAD_REQUEST, 'bad_request', 'This assignment takes files only.');
      const [saved] = await tx.update(assignmentSubmissions).set({ body: input.body }).where(eq(assignmentSubmissions.id, submission.id)).returning();
      return this.describeSubmission(tx, saved!);
    });
  }

  /** Hands the submission in. It completes the lesson, and the course's editors are told. */
  async submit(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, ip: string | null): Promise<Submission> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const { course, lesson, assignment, submission } = await this.ownSubmission(tx, school, userId, courseSlug, lessonId);
      if (!editableStatuses.has(submission.status)) throw notEditable();
      const files = await tx.select().from(submissionFiles).where(eq(submissionFiles.submissionId, submission.id));
      if (files.some((file) => !file.uploaded)) throw new ApiException(HttpStatus.CONFLICT, 'conflict', 'Wait for your files to finish uploading.');
      const hasText = assignment.allowText && submission.body.trim().length > 0;
      if (!hasText && !(assignment.allowFiles && files.length > 0)) {
        throw new ApiException(HttpStatus.BAD_REQUEST, 'bad_request', assignment.allowFiles ? 'Write your answer or add a file before handing it in.' : 'Write your answer before handing it in.');
      }
      const [saved] = await tx
        .update(assignmentSubmissions)
        .set({ status: 'submitted', submittedAt: sql`now()` })
        .where(eq(assignmentSubmissions.id, submission.id))
        .returning();
      await this.progress.markCompleted(tx, school.id, lesson, userId);
      await this.outbox.add(tx, 'assignment.submitted', { submissionId: submission.id, lessonId: lesson.id, courseId: course.id, studentId: userId }, school.id);
      await this.audit.record(tx, { action: 'assignment.submitted', actorId: userId, schoolId: school.id, targetType: 'submission', targetId: submission.id, ip });
      return this.describeSubmission(tx, saved!);
    });
  }

  /**
   * Starts a file upload: checks the limits, holds its size against the school's quota, and
   * returns where to PUT it. The file counts once completeFile has checked it arrived.
   */
  async startFile(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, input: SubmissionFileInput): Promise<SubmissionUploadTicket> {
    if (!this.storage.enabled) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'service_unavailable', "File uploads aren't set up on this server yet.");
    const file = await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const { assignment, submission } = await this.ownSubmission(tx, school, userId, courseSlug, lessonId);
      if (!assignment.allowFiles) throw new ApiException(HttpStatus.BAD_REQUEST, 'bad_request', 'This assignment takes a written answer only.');
      if (!editableStatuses.has(submission.status)) throw notEditable();
      const [{ files } = { files: 0 }] = await tx.select({ files: count() }).from(submissionFiles).where(eq(submissionFiles.submissionId, submission.id));
      if (files >= MAX_SUBMISSION_FILES) throw new ApiException(HttpStatus.FORBIDDEN, 'limit_reached', `A submission can have up to ${MAX_SUBMISSION_FILES} files.`);
      await reserveQuota(tx, school.id, input.size);
      const [created] = await tx
        .insert(submissionFiles)
        .values({ schoolId: school.id, submissionId: submission.id, fileName: input.fileName, contentType: input.contentType, sizeBytes: input.size })
        .returning();
      return created!;
    });
    const { url, expiresAt } = await this.storage.presignPut(submissionFileKey(school.id, file.submissionId, file.id), file.contentType, FILE_URL_TTL_SECONDS);
    return { file: toFile(file), url, contentType: file.contentType, expiresAt: expiresAt.toISOString() };
  }

  /** Checks the file arrived at its declared size; a mismatch removes it. */
  async completeFile(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, fileId: string): Promise<Submission> {
    const { file } = await this.db.transaction({ userId, schoolId: school.id }, (tx) => this.ownFile(tx, school, userId, courseSlug, lessonId, fileId));
    const key = submissionFileKey(school.id, file.submissionId, file.id);
    const size = await this.storage.size(key);
    const result = await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const [current] = await tx.select().from(submissionFiles).where(eq(submissionFiles.id, file.id)).for('update');
      if (!current) throw notFound('This file');
      if (current.uploaded) return { ok: true, submissionId: current.submissionId };
      await releaseQuota(tx, school.id, current.sizeBytes);
      if (size !== current.sizeBytes) {
        await tx.delete(submissionFiles).where(eq(submissionFiles.id, current.id));
        return { ok: false, submissionId: current.submissionId };
      }
      await addUsedQuota(tx, school.id, current.sizeBytes);
      await tx.update(submissionFiles).set({ uploaded: true }).where(eq(submissionFiles.id, current.id));
      return { ok: true, submissionId: current.submissionId };
    });
    if (!result.ok) {
      await this.storage.deleteObject(key).catch(() => {});
      throw new ApiException(HttpStatus.BAD_REQUEST, 'bad_request', "The file didn't upload completely. Try again.");
    }
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const [submission] = await tx.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.id, result.submissionId));
      return this.describeSubmission(tx, submission!);
    });
  }

  /** Removes a file from a submission that can still be changed. */
  async removeFile(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, fileId: string): Promise<Submission> {
    const { file, submission } = await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const found = await this.ownFile(tx, school, userId, courseSlug, lessonId, fileId);
      if (!editableStatuses.has(found.submission.status)) throw notEditable();
      await tx.delete(submissionFiles).where(eq(submissionFiles.id, found.file.id));
      if (found.file.uploaded) await addUsedQuota(tx, school.id, -found.file.sizeBytes);
      else await releaseQuota(tx, school.id, found.file.sizeBytes);
      return found;
    });
    await this.storage.deleteObject(submissionFileKey(school.id, file.submissionId, file.id)).catch(() => {});
    return this.db.transaction({ userId, schoolId: school.id }, (tx) => this.describeSubmission(tx, submission));
  }

  /** A short-lived address that downloads a file: for its student and the course's editors. */
  async download(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, submissionId: string, fileId: string) {
    const file = await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const { course, lesson } = await this.open(tx, school, userId, courseSlug, lessonId);
      const [row] = await tx
        .select({ file: submissionFiles, ownerId: assignmentSubmissions.userId })
        .from(submissionFiles)
        .innerJoin(assignmentSubmissions, eq(assignmentSubmissions.id, submissionFiles.submissionId))
        .where(and(eq(submissionFiles.id, fileId), eq(submissionFiles.submissionId, submissionId), eq(assignmentSubmissions.lessonId, lesson.id)));
      if (!row || !row.file.uploaded || (row.ownerId !== userId && !canEditCourse(school, userId, course))) throw notFound('This file');
      return row.file;
    });
    const { url, expiresAt } = await this.storage.signedDownload(submissionFileKey(school.id, file.submissionId, file.id), file.fileName, FILE_URL_TTL_SECONDS);
    return { url, expiresAt: expiresAt.toISOString() };
  }

  /** Every handed-in submission, oldest waiting first (the course's editors only). */
  async list(school: SchoolContext, userId: string, courseSlug: string, lessonId: string): Promise<SubmissionSummary[]> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const { lesson } = await this.editable(tx, school, userId, courseSlug, lessonId);
      const fileCount = tx
        .select({ submissionId: submissionFiles.submissionId, files: sql<number>`count(*)::int`.as('files') })
        .from(submissionFiles)
        .groupBy(submissionFiles.submissionId)
        .as('file_count');
      const rows = await tx
        .select({ submission: assignmentSubmissions, name: users.name, email: users.email, files: fileCount.files })
        .from(assignmentSubmissions)
        .innerJoin(users, eq(users.id, assignmentSubmissions.userId))
        .leftJoin(fileCount, eq(fileCount.submissionId, assignmentSubmissions.id))
        .where(and(eq(assignmentSubmissions.lessonId, lesson.id), sql`${assignmentSubmissions.status} <> 'draft'`))
        .orderBy(sql`${assignmentSubmissions.status} = 'submitted' desc`, asc(assignmentSubmissions.submittedAt))
        .limit(1000);
      return rows.map(({ submission, name, email, files }) => ({
        id: submission.id,
        student: { id: submission.userId, name, email },
        status: submission.status,
        grade: submission.grade,
        submittedAt: submission.submittedAt?.toISOString() ?? null,
        gradedAt: submission.gradedAt?.toISOString() ?? null,
        fileCount: files ?? 0,
      }));
    });
  }

  async getSubmission(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, submissionId: string): Promise<Submission> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const { lesson } = await this.editable(tx, school, userId, courseSlug, lessonId);
      return this.describeSubmission(tx, await this.submissionOf(tx, lesson, submissionId));
    });
  }

  /** Grades a handed-in submission, or returns it for another try. The student is told. */
  async grade(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, submissionId: string, input: GradeInput, ip: string | null): Promise<Submission> {
    return this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const { course, lesson, assignment } = await this.editable(tx, school, userId, courseSlug, lessonId);
      const submission = await this.submissionOf(tx, lesson, submissionId, { forUpdate: true });
      if (submission.status === 'draft') throw new ApiException(HttpStatus.CONFLICT, 'conflict', "This submission hasn't been handed in yet.");
      if (input.grade !== null && input.grade > assignment.maxPoints) {
        throw new ApiException(HttpStatus.BAD_REQUEST, 'validation_failed', `The grade can be at most ${assignment.maxPoints}.`, [
          { path: 'grade', message: `At most ${assignment.maxPoints}` },
        ]);
      }
      const [saved] = await tx
        .update(assignmentSubmissions)
        .set({ status: input.status, grade: input.grade, feedback: input.feedback, gradedBy: userId, gradedAt: sql`now()` })
        .where(eq(assignmentSubmissions.id, submission.id))
        .returning();
      await this.outbox.add(
        tx,
        'assignment.graded',
        { submissionId: submission.id, lessonId: lesson.id, courseId: course.id, studentId: submission.userId, status: input.status, grade: input.grade, maxPoints: assignment.maxPoints },
        school.id,
      );
      await this.audit.record(tx, {
        action: input.status === 'graded' ? 'assignment.graded' : 'assignment.returned',
        actorId: userId,
        schoolId: school.id,
        targetType: 'submission',
        targetId: submission.id,
        ip,
        data: { grade: input.grade },
      });
      return this.describeSubmission(tx, saved!);
    });
  }

  // Lookups ---------------------------------------------------------------------------------------

  private async open(tx: Tx, school: SchoolContext, userId: string, courseSlug: string, lessonId: string) {
    const course = await this.courses.findVisible(tx, school, userId, courseSlug);
    const { lesson } = await this.lessons.find(tx, school, userId, course, lessonId);
    const enrolled = await this.lessons.isEnrolled(tx, course.id, userId);
    if (!canWatchLesson(school, userId, course, lesson, enrolled)) throw enrollmentRequired();
    return { course, lesson, enrolled, assignment: await this.assignmentOf(tx, lesson) };
  }

  private async editable(tx: Tx, school: SchoolContext, userId: string, courseSlug: string, lessonId: string) {
    const course = await this.courses.findEditable(tx, school, userId, courseSlug);
    const { lesson } = await this.lessons.find(tx, school, userId, course, lessonId);
    return { course, lesson, assignment: await this.assignmentOf(tx, lesson) };
  }

  /** The enrolled student's submission, created as an empty draft if they have none, and locked. */
  private async ownSubmission(tx: Tx, school: SchoolContext, userId: string, courseSlug: string, lessonId: string) {
    const { course, lesson, enrolled, assignment } = await this.open(tx, school, userId, courseSlug, lessonId);
    if (!enrolled) throw enrollmentRequired();
    await tx.insert(assignmentSubmissions).values({ schoolId: school.id, courseId: course.id, lessonId: lesson.id, userId }).onConflictDoNothing();
    const [submission] = await tx
      .select()
      .from(assignmentSubmissions)
      .where(and(eq(assignmentSubmissions.lessonId, lesson.id), eq(assignmentSubmissions.userId, userId)))
      .for('update');
    return { course, lesson, assignment, submission: submission! };
  }

  private async ownFile(tx: Tx, school: SchoolContext, userId: string, courseSlug: string, lessonId: string, fileId: string) {
    const { submission } = await this.ownSubmission(tx, school, userId, courseSlug, lessonId);
    const [file] = await tx.select().from(submissionFiles).where(and(eq(submissionFiles.id, fileId), eq(submissionFiles.submissionId, submission.id)));
    if (!file) throw notFound('This file');
    return { file, submission };
  }

  private async assignmentOf(tx: Tx, lesson: LessonRecord): Promise<AssignmentRecord> {
    if (lesson.kind !== 'assignment') throw notFound('An assignment in this lesson');
    const [assignment] = await tx.select().from(assignments).where(eq(assignments.lessonId, lesson.id));
    if (!assignment) throw notFound('This assignment');
    return assignment;
  }

  private async submissionOf(tx: Tx, lesson: LessonRecord, submissionId: string, { forUpdate = false } = {}) {
    const query = tx.select().from(assignmentSubmissions).where(and(eq(assignmentSubmissions.id, submissionId), eq(assignmentSubmissions.lessonId, lesson.id)));
    const [submission] = forUpdate ? await query.for('update') : await query;
    if (!submission) throw notFound('This submission');
    return submission;
  }

  // Views -----------------------------------------------------------------------------------------

  private async describe(tx: Tx, school: SchoolContext, userId: string, course: CourseRecord, assignment: AssignmentRecord): Promise<Assignment> {
    const [own] = await tx
      .select()
      .from(assignmentSubmissions)
      .where(and(eq(assignmentSubmissions.lessonId, assignment.lessonId), eq(assignmentSubmissions.userId, userId)));
    let counts: Assignment['counts'] = null;
    if (canEditCourse(school, userId, course)) {
      const rows = await tx
        .select({ status: assignmentSubmissions.status, total: count() })
        .from(assignmentSubmissions)
        .where(eq(assignmentSubmissions.lessonId, assignment.lessonId))
        .groupBy(assignmentSubmissions.status);
      const of = (status: SubmissionRecord['status']) => rows.find((row) => row.status === status)?.total ?? 0;
      counts = { submitted: of('submitted'), graded: of('graded'), returned: of('returned') };
    }
    return {
      lessonId: assignment.lessonId,
      maxPoints: assignment.maxPoints,
      allowText: assignment.allowText,
      allowFiles: assignment.allowFiles,
      dueAt: assignment.dueAt?.toISOString() ?? null,
      submission: own ? await this.describeSubmission(tx, own) : null,
      counts,
    };
  }

  private async describeSubmission(tx: Tx, submission: SubmissionRecord): Promise<Submission> {
    const [files, [student]] = await Promise.all([
      tx.select().from(submissionFiles).where(eq(submissionFiles.submissionId, submission.id)).orderBy(asc(submissionFiles.createdAt)),
      tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, submission.userId)),
    ]);
    return {
      id: submission.id,
      status: submission.status,
      body: submission.body,
      grade: submission.grade,
      feedback: submission.feedback,
      submittedAt: submission.submittedAt?.toISOString() ?? null,
      gradedAt: submission.gradedAt?.toISOString() ?? null,
      updatedAt: submission.updatedAt.toISOString(),
      files: files.map(toFile),
      student: student!,
    };
  }
}

const toFile = (file: FileRecord) => ({
  id: file.id,
  fileName: file.fileName,
  contentType: file.contentType,
  sizeBytes: file.sizeBytes,
  uploaded: file.uploaded,
});

