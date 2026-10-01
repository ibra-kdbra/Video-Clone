import {
  COMPLETION_SHARE,
  MAX_SUBMISSION_FILES,
  PROGRESS_SEGMENT_SECONDS,
  assignmentInput,
  courseSlug,
  gradeInput,
  progressInput,
  quizAttemptInput,
  quizInput,
  submissionFileInput,
  submissionInput,
  uuid,
} from '@grand/contracts';

import { HttpError, badRequest, conflict, keeping, notFound } from '../http.js';
import { randomId } from '../ids.js';
import {
  canEditCourse,
  canWatchLesson,
  countSegments,
  forEditor,
  forTaker,
  formatSize,
  fromHex,
  gradeQuiz,
  hasSegment,
  iso,
  lessonProgressDetail,
  markSegments,
  segmentCount,
  storeQuestions,
  toHex,
} from '../logic.js';
import { enrollmentRequired, findEditable, findLesson, findVisible, isEnrolled, lessonsInOrder, markCompleted, progressRow } from './shared.js';

/**
 * Progress, quizzes, assignments and insights (apps/api/src/learning): watch progress as a bitset
 * of 5-second stretches that completes an uploaded video at 90%, quizzes graded here with the
 * answers shown only once earned, assignments from draft to graded, and the editors' insights.
 */

const lesson = { courseSlug, lessonId: uuid };
const base = '/schools/:slug/courses/:courseSlug/lessons/:lessonId';

const rate = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

const editableStatuses = new Set(['draft', 'returned']);
const notEditable = () => conflict('This submission has been handed in. It can be changed again if it is returned to you.');

/** Uploaded files live in this tab's memory only; their names and sizes are saved. */
export const FILE_GONE = "This file was only kept for the visit when it was added: the demo doesn't store files. Its name and size are still here.";

export function register(router, server) {
  // Lookups ----------------------------------------------------------------------------------------

  /** A lesson this person may open (enrolled, a preview, or its editor). */
  const open = (ctx) => {
    const course = findVisible(ctx, ctx.params.courseSlug);
    const found = findLesson(ctx, course, ctx.params.lessonId);
    const enrolled = isEnrolled(ctx.db, course.id, ctx.auth.userId);
    if (!canWatchLesson(ctx.school, ctx.auth.userId, course, found, enrolled)) throw enrollmentRequired();
    return { course, lesson: found, enrolled };
  };

  /** A lesson only its enrolled students record progress on. */
  const watchable = (ctx) => {
    const found = open(ctx);
    if (!found.enrolled) throw enrollmentRequired();
    return found;
  };

  const editable = (ctx) => {
    const course = findEditable(ctx, ctx.params.courseSlug);
    return { course, lesson: findLesson(ctx, course, ctx.params.lessonId) };
  };

  const quizOf = (db, found) => {
    if (found.kind !== 'quiz') throw notFound('A quiz in this lesson');
    const quiz = db.get('quizzes', found.id);
    if (!quiz) throw notFound('This quiz');
    return quiz;
  };

  const assignmentOf = (db, found) => {
    if (found.kind !== 'assignment') throw notFound('An assignment in this lesson');
    const assignment = db.get('assignments', found.id);
    if (!assignment) throw notFound('This assignment');
    return assignment;
  };

  // Progress ---------------------------------------------------------------------------------------

  router.add('PUT', `${base}/progress`, { school: 'student', params: lesson, body: progressInput }, (ctx) => {
    const { lesson: found } = watchable(ctx);
    if (found.kind !== 'lesson') throw conflict('Only lessons with a video record watching.');
    const row = progressRow(ctx, found, ctx.auth.userId);
    const duration = found.durationSeconds ?? 0;
    const total = duration > 0 ? segmentCount(duration) : 0;
    const before = fromHex(row.watched);
    const watched = total ? markSegments(before, ctx.body.segments, total) : before;
    const count = total ? countSegments(watched, total) : 0;
    // An uploaded video is complete once most of it has played; others are marked by hand.
    const done = found.videoProvider === 'upload' && total > 0 && count >= Math.ceil(total * COMPLETION_SHARE);
    const updated = ctx.db.update('progress', row.id, {
      watched: toHex(watched),
      watchedSeconds: total ? Math.min(duration, count * PROGRESS_SEGMENT_SECONDS) : 0,
      positionSeconds: Math.floor(duration ? Math.min(ctx.body.positionSeconds, duration) : ctx.body.positionSeconds),
      ...(done && !row.completedAt && { completedAt: ctx.now }),
      updatedAt: ctx.now,
    });
    return lessonProgressDetail(found, updated);
  });

  router.add('POST', `${base}/complete`, { school: 'student', params: lesson }, (ctx) => {
    const { lesson: found } = watchable(ctx);
    if (found.kind !== 'lesson' || found.videoProvider === 'upload') {
      throw conflict(
        found.kind === 'quiz'
          ? 'A quiz is completed by passing it.'
          : found.kind === 'assignment'
            ? 'An assignment is completed by handing it in.'
            : 'This lesson completes once you have watched its video.',
      );
    }
    return lessonProgressDetail(found, markCompleted(ctx, found, ctx.auth.userId));
  });

  // Quizzes ----------------------------------------------------------------------------------------

  const summary = (attempt) => ({
    id: attempt.id,
    score: attempt.score,
    maxScore: attempt.maxScore,
    percent: attempt.percent,
    passed: attempt.passed,
    createdAt: iso(attempt.createdAt),
  });
  const myAttempts = (db, lessonId, userId) => db.filter('attempts', (row) => row.lessonId === lessonId && row.userId === userId).sort((a, b) => b.createdAt - a.createdAt);

  /** An attempt's marks, with the right answers once they can no longer be used to pass. */
  const describeAttempt = (db, quiz, attempt, userId) => {
    const all = myAttempts(db, quiz.id, userId);
    const attemptsLeft = quiz.maxAttempts === null ? null : Math.max(0, quiz.maxAttempts - all.length);
    const reveal = all.some((row) => row.passed) || attemptsLeft === 0;
    return {
      ...summary(attempt),
      answers: attempt.answers,
      attemptsLeft,
      questions: attempt.results.map((result) => {
        const question = reveal ? quiz.questions.find((candidate) => candidate.id === result.questionId) : undefined;
        return {
          ...result,
          explanation: question?.explanation || null,
          correctOptionIds: question && question.kind !== 'short' ? question.options.filter((option) => option.correct).map((option) => option.id) : null,
          acceptedAnswers: question?.kind === 'short' ? question.answers : null,
        };
      }),
    };
  };

  const describeDraft = (db, quiz) => ({
    lessonId: quiz.id,
    passPercent: quiz.passPercent,
    maxAttempts: quiz.maxAttempts,
    questions: quiz.questions.map(forEditor),
    attemptCount: db.count('attempts', (row) => row.lessonId === quiz.id),
  });

  router.add('GET', `${base}/quiz`, { school: 'student', params: lesson }, (ctx) => {
    const { lesson: found } = open(ctx);
    const quiz = quizOf(ctx.db, found);
    const attempts = myAttempts(ctx.db, found.id, ctx.auth.userId).slice(0, 100);
    return {
      lessonId: quiz.id,
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

  router.add('GET', `${base}/quiz/draft`, { school: 'instructor', params: lesson }, (ctx) => describeDraft(ctx.db, quizOf(ctx.db, editable(ctx).lesson)));

  router.add('PUT', `${base}/quiz`, { school: 'instructor', params: lesson, body: quizInput }, (ctx) => {
    const quiz = quizOf(ctx.db, editable(ctx).lesson);
    const saved = ctx.db.update('quizzes', quiz.id, {
      passPercent: ctx.body.passPercent,
      maxAttempts: ctx.body.maxAttempts,
      questions: storeQuestions(ctx.body.questions, randomId),
    });
    return describeDraft(ctx.db, saved);
  });

  router.add('POST', `${base}/quiz/attempts`, { school: 'student', params: lesson, body: quizAttemptInput }, (ctx) => {
    const { db, auth } = ctx;
    const { course, lesson: found, enrolled } = open(ctx);
    const quiz = quizOf(db, found);
    if (!enrolled) throw enrollmentRequired();
    if (quiz.questions.length === 0) throw conflict("This quiz doesn't have any questions yet.");
    const made = myAttempts(db, found.id, auth.userId).length;
    if (quiz.maxAttempts !== null && made >= quiz.maxAttempts) throw new HttpError(403, 'limit_reached', "You've used all your attempts at this quiz.");
    const grade = gradeQuiz(quiz.questions, ctx.body.answers);
    const passed = grade.percent >= quiz.passPercent;
    const attempt = db.put('attempts', {
      id: randomId(),
      schoolId: course.schoolId,
      courseId: course.id,
      lessonId: found.id,
      userId: auth.userId,
      answers: ctx.body.answers,
      results: grade.results,
      score: grade.score,
      maxScore: grade.maxScore,
      percent: grade.percent,
      passed,
      createdAt: ctx.now,
    });
    if (passed) markCompleted(ctx, found, auth.userId);
    return describeAttempt(db, quiz, attempt, auth.userId);
  });

  router.add('GET', `${base}/quiz/attempts/:attemptId`, { school: 'student', params: { ...lesson, attemptId: uuid } }, (ctx) => {
    const { lesson: found } = open(ctx);
    const quiz = quizOf(ctx.db, found);
    const attempt = ctx.db.get('attempts', ctx.params.attemptId);
    if (!attempt || attempt.lessonId !== found.id || attempt.userId !== ctx.auth.userId) throw notFound('This attempt');
    return describeAttempt(ctx.db, quiz, attempt, ctx.auth.userId);
  });

  // Assignments ------------------------------------------------------------------------------------

  const toFile = (file) => ({ id: file.id, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.sizeBytes, uploaded: file.uploaded });
  const filesOf = (db, submissionId) => db.filter('files', (row) => row.submissionId === submissionId).sort((a, b) => a.createdAt - b.createdAt);

  const describeSubmission = (db, submission) => {
    const student = db.get('users', submission.userId);
    return {
      id: submission.id,
      status: submission.status,
      body: submission.body,
      grade: submission.grade,
      feedback: submission.feedback,
      submittedAt: iso(submission.submittedAt),
      gradedAt: iso(submission.gradedAt),
      updatedAt: iso(submission.updatedAt),
      files: filesOf(db, submission.id).map(toFile),
      student: { id: student.id, name: student.name, email: student.email },
    };
  };

  const describeAssignment = (ctx, course, assignment) => {
    const { db, school, auth } = ctx;
    const own = db.find('submissions', (row) => row.lessonId === assignment.id && row.userId === auth.userId);
    let counts = null;
    if (canEditCourse(school, auth.userId, course)) {
      const of = (status) => db.count('submissions', (row) => row.lessonId === assignment.id && row.status === status);
      counts = { submitted: of('submitted'), graded: of('graded'), returned: of('returned') };
    }
    return {
      lessonId: assignment.id,
      maxPoints: assignment.maxPoints,
      allowText: assignment.allowText,
      allowFiles: assignment.allowFiles,
      dueAt: iso(assignment.dueAt),
      submission: own ? describeSubmission(db, own) : null,
      counts,
    };
  };

  /** The enrolled student's own submission, started as an empty draft if they have none. */
  const ownSubmission = (ctx) => {
    const { course, lesson: found, enrolled } = open(ctx);
    const assignment = assignmentOf(ctx.db, found);
    if (!enrolled) throw enrollmentRequired();
    const submission =
      ctx.db.find('submissions', (row) => row.lessonId === found.id && row.userId === ctx.auth.userId) ??
      ctx.db.put('submissions', {
        id: randomId(),
        schoolId: course.schoolId,
        courseId: course.id,
        lessonId: found.id,
        userId: ctx.auth.userId,
        status: 'draft',
        body: '',
        grade: null,
        feedback: '',
        submittedAt: null,
        gradedAt: null,
        gradedBy: null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    return { course, lesson: found, assignment, submission };
  };

  const ownFile = (ctx) => {
    const found = ownSubmission(ctx);
    const file = ctx.db.get('files', ctx.params.fileId);
    if (!file || file.submissionId !== found.submission.id) throw notFound('This file');
    return { ...found, file };
  };

  router.add('GET', `${base}/assignment`, { school: 'student', params: lesson }, (ctx) => {
    const { course, lesson: found } = open(ctx);
    return describeAssignment(ctx, course, assignmentOf(ctx.db, found));
  });

  router.add('PUT', `${base}/assignment`, { school: 'instructor', params: lesson, body: assignmentInput }, (ctx) => {
    const { course, lesson: found } = editable(ctx);
    const assignment = assignmentOf(ctx.db, found);
    const { maxPoints, allowText, allowFiles, dueAt } = ctx.body;
    const saved = ctx.db.update('assignments', assignment.id, { maxPoints, allowText, allowFiles, dueAt: dueAt ? Date.parse(dueAt) : null });
    return describeAssignment(ctx, course, saved);
  });

  router.add('PUT', `${base}/assignment/submission`, { school: 'student', params: lesson, body: submissionInput }, (ctx) => {
    const { assignment, submission } = ownSubmission(ctx);
    if (!editableStatuses.has(submission.status)) throw notEditable();
    if (ctx.body.body && !assignment.allowText) throw badRequest('This assignment takes files only.');
    return describeSubmission(ctx.db, ctx.db.update('submissions', submission.id, { body: ctx.body.body, updatedAt: ctx.now }));
  });

  router.add('POST', `${base}/assignment/submission/submit`, { school: 'student', params: lesson }, (ctx) => {
    const { db, auth, school } = ctx;
    const { course, lesson: found, assignment, submission } = ownSubmission(ctx);
    if (!editableStatuses.has(submission.status)) throw notEditable();
    const files = filesOf(db, submission.id);
    if (files.some((file) => !file.uploaded)) throw conflict('Wait for your files to finish uploading.');
    const hasText = assignment.allowText && submission.body.trim().length > 0;
    if (!hasText && !(assignment.allowFiles && files.length > 0)) {
      throw badRequest(assignment.allowFiles ? 'Write your answer or add a file before handing it in.' : 'Write your answer before handing it in.');
    }
    const saved = db.update('submissions', submission.id, { status: 'submitted', submittedAt: ctx.now, updatedAt: ctx.now });
    markCompleted(ctx, found, auth.userId);
    server.submitted({ school, course, lesson: found, submission: saved });
    return describeSubmission(db, saved);
  });

  router.add('POST', `${base}/assignment/submission/files`, { school: 'student', params: lesson, body: submissionFileInput }, (ctx) => {
    const { db, body, school } = ctx;
    const { assignment, submission } = ownSubmission(ctx);
    if (!assignment.allowFiles) throw badRequest('This assignment takes a written answer only.');
    if (!editableStatuses.has(submission.status)) throw notEditable();
    if (filesOf(db, submission.id).length >= MAX_SUBMISSION_FILES) throw new HttpError(403, 'limit_reached', `A submission can have up to ${MAX_SUBMISSION_FILES} files.`);
    const storage = db.get('storage', school.id);
    const free = storage.quotaBytes - storage.usedBytes - storage.reservedBytes;
    if (body.size > free)
      throw new HttpError(403, 'quota_exceeded', `This school has ${formatSize(Math.max(0, free))} of storage left, and this file needs ${formatSize(body.size)}.`);
    db.update('storage', school.id, { reservedBytes: storage.reservedBytes + body.size });
    const file = db.put('files', {
      id: randomId(),
      submissionId: submission.id,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.size,
      uploaded: false,
      sample: false,
      createdAt: ctx.now,
    });
    // The browser "uploads" to this address; the demo keeps the file in memory (see xhr.js).
    return { file: toFile(file), url: `demo-upload:${file.id}`, contentType: file.contentType, expiresAt: iso(ctx.now + 15 * 60_000) };
  });

  router.add('POST', `${base}/assignment/submission/files/:fileId/complete`, { school: 'student', params: { ...lesson, fileId: uuid } }, (ctx) => {
    const { db, school } = ctx;
    const { file, submission } = ownFile(ctx);
    if (!file.uploaded) {
      const storage = db.get('storage', school.id);
      const arrived = server.files.get(file.id);
      db.update('storage', school.id, { reservedBytes: Math.max(0, storage.reservedBytes - file.sizeBytes) });
      if (!arrived || arrived.size !== file.sizeBytes) {
        db.remove('files', file.id);
        server.files.drop(file.id);
        throw keeping(badRequest("The file didn't upload completely. Try again."));
      }
      db.update('storage', school.id, (row) => ({ usedBytes: row.usedBytes + file.sizeBytes }));
      db.update('files', file.id, { uploaded: true });
    }
    return describeSubmission(db, db.get('submissions', submission.id));
  });

  router.add('DELETE', `${base}/assignment/submission/files/:fileId`, { school: 'student', params: { ...lesson, fileId: uuid }, status: 200 }, (ctx) => {
    const { db, school } = ctx;
    const { file, submission } = ownFile(ctx);
    if (!editableStatuses.has(submission.status)) throw notEditable();
    db.remove('files', file.id);
    db.update('storage', school.id, (row) =>
      file.uploaded ? { usedBytes: Math.max(0, row.usedBytes - file.sizeBytes) } : { reservedBytes: Math.max(0, row.reservedBytes - file.sizeBytes) },
    );
    server.files.drop(file.id);
    return describeSubmission(db, submission);
  });

  router.add('GET', `${base}/assignment/submissions`, { school: 'instructor', params: lesson }, (ctx) => {
    const { db } = ctx;
    const { lesson: found } = editable(ctx);
    assignmentOf(db, found);
    return db
      .filter('submissions', (row) => row.lessonId === found.id && row.status !== 'draft')
      .sort((a, b) => Number(b.status === 'submitted') - Number(a.status === 'submitted') || (a.submittedAt ?? Infinity) - (b.submittedAt ?? Infinity))
      .slice(0, 1000)
      .map((row) => {
        const student = db.get('users', row.userId);
        return {
          id: row.id,
          student: { id: student.id, name: student.name, email: student.email },
          status: row.status,
          grade: row.grade,
          submittedAt: iso(row.submittedAt),
          gradedAt: iso(row.gradedAt),
          fileCount: db.count('files', (file) => file.submissionId === row.id),
        };
      });
  });

  const submissionOf = (db, found, submissionId) => {
    const submission = db.get('submissions', submissionId);
    if (!submission || submission.lessonId !== found.id) throw notFound('This submission');
    return submission;
  };

  router.add('GET', `${base}/assignment/submissions/:submissionId`, { school: 'instructor', params: { ...lesson, submissionId: uuid } }, (ctx) => {
    const { lesson: found } = editable(ctx);
    assignmentOf(ctx.db, found);
    return describeSubmission(ctx.db, submissionOf(ctx.db, found, ctx.params.submissionId));
  });

  router.add('POST', `${base}/assignment/submissions/:submissionId/grade`, { school: 'instructor', params: { ...lesson, submissionId: uuid }, body: gradeInput }, (ctx) => {
    const { db, body, auth, school } = ctx;
    const { course, lesson: found } = editable(ctx);
    const assignment = assignmentOf(db, found);
    const submission = submissionOf(db, found, ctx.params.submissionId);
    if (submission.status === 'draft') throw conflict("This submission hasn't been handed in yet.");
    if (body.grade !== null && body.grade > assignment.maxPoints) {
      throw new HttpError(400, 'validation_failed', `The grade can be at most ${assignment.maxPoints}.`, [{ path: 'grade', message: `At most ${assignment.maxPoints}` }]);
    }
    const saved = db.update('submissions', submission.id, {
      status: body.status,
      grade: body.grade,
      feedback: body.feedback,
      gradedBy: auth.userId,
      gradedAt: ctx.now,
      updatedAt: ctx.now,
    });
    server.graded({ school, course, lesson: found, assignment, submission: saved });
    return describeSubmission(db, saved);
  });

  router.add('GET', `${base}/assignment/submissions/:submissionId/files/:fileId`, { school: 'student', params: { ...lesson, submissionId: uuid, fileId: uuid } }, (ctx) => {
    const { db, school, auth } = ctx;
    const { course, lesson: found } = open(ctx);
    assignmentOf(db, found);
    const file = db.get('files', ctx.params.fileId);
    const submission = file && db.get('submissions', file.submissionId);
    if (
      !file ||
      file.submissionId !== ctx.params.submissionId ||
      submission?.lessonId !== found.id ||
      !file.uploaded ||
      (submission.userId !== auth.userId && !canEditCourse(school, auth.userId, course))
    ) {
      throw notFound('This file');
    }
    const url = server.files.url(file, { submission, lesson: found });
    if (!url) throw new HttpError(404, 'not_found', FILE_GONE);
    return { url, expiresAt: iso(ctx.now + 15 * 60_000) };
  });

  // Insights ---------------------------------------------------------------------------------------

  router.add('GET', '/schools/:slug/courses/:courseSlug/insights', { school: 'instructor', params: { courseSlug } }, (ctx) => {
    const { db } = ctx;
    const course = findEditable(ctx, ctx.params.courseSlug);
    const modules = new Map(db.filter('modules', (row) => row.courseId === course.id).map((row) => [row.id, row]));
    const lessons = lessonsInOrder(db, course);
    const students = db.filter('enrollments', (row) => row.courseId === course.id).map((row) => row.userId);
    const enrolled = new Set(students);
    const progress = db.filter('progress', (row) => row.courseId === course.id && enrolled.has(row.userId));
    const attempts = new Map();
    for (const row of db.filter('attempts', (item) => item.courseId === course.id && enrolled.has(item.userId))) {
      const key = `${row.lessonId}:${row.userId}`;
      const group = attempts.get(key) ?? { lessonId: row.lessonId, attempts: 0, best: 0, passed: false };
      group.attempts += 1;
      group.best = Math.max(group.best, row.percent);
      group.passed ||= row.passed;
      attempts.set(key, group);
    }
    const submissions = db.filter('submissions', (row) => row.courseId === course.id && enrolled.has(row.userId) && row.status !== 'draft');
    const published = new Set(lessons.filter((row) => row.status === 'published').map((row) => row.id));
    const completedByUser = new Map();
    for (const row of progress) if (row.completedAt && published.has(row.lessonId)) completedByUser.set(row.userId, (completedByUser.get(row.userId) ?? 0) + 1);
    const weekAgo = ctx.now - 7 * 86_400_000;

    const insights = lessons.map((item) => {
      const rows = progress.filter((row) => row.lessonId === item.id);
      const completed = rows.filter((row) => row.completedAt).length;
      const watched =
        item.kind === 'lesson' && item.videoProvider === 'upload' && item.durationSeconds
          ? average(rows.map((row) => Math.min(100, (row.watchedSeconds / item.durationSeconds) * 100)))
          : null;
      const groups = [...attempts.values()].filter((group) => group.lessonId === item.id);
      const handedIn = submissions.filter((row) => row.lessonId === item.id);
      const grades = handedIn.filter((row) => row.status === 'graded' && row.grade !== null).map((row) => row.grade);
      return {
        lessonId: item.id,
        moduleTitle: modules.get(item.moduleId)?.title ?? '',
        title: item.title,
        kind: item.kind,
        started: rows.length,
        completed,
        completionRate: rate(completed, students.length),
        averageWatchedPercent: watched === null ? null : Math.round(watched),
        quiz:
          item.kind === 'quiz'
            ? {
                students: groups.length,
                attempts: groups.reduce((sum, group) => sum + group.attempts, 0),
                passRate: rate(groups.filter((group) => group.passed).length, groups.length),
                averageBestPercent: Math.round(average(groups.map((group) => group.best)) ?? 0),
              }
            : null,
        assignment:
          item.kind === 'assignment'
            ? {
                submitted: handedIn.length,
                graded: grades.length,
                averageGrade: grades.length ? Math.round(average(grades) * 10) / 10 : null,
                maxPoints: db.get('assignments', item.id)?.maxPoints ?? 100,
              }
            : null,
      };
    });

    return {
      enrolled: students.length,
      activeLast7Days: new Set(progress.filter((row) => row.updatedAt >= weekAgo).map((row) => row.userId)).size,
      completedCourse: published.size ? students.filter((id) => (completedByUser.get(id) ?? 0) >= published.size).length : 0,
      averagePercent: published.size ? Math.round(average(students.map((id) => ((completedByUser.get(id) ?? 0) / published.size) * 100)) ?? 0) : 0,
      lessons: insights,
    };
  });

  router.add('GET', `${base}/insights`, { school: 'instructor', params: lesson }, (ctx) => {
    const { db } = ctx;
    const { course, lesson: found } = editable(ctx);
    const detail = { lessonId: found.id, kind: found.kind, retention: null, questions: null };
    const enrolled = new Set(db.filter('enrollments', (row) => row.courseId === course.id).map((row) => row.userId));
    if (found.kind === 'lesson' && found.videoProvider === 'upload' && found.durationSeconds) {
      const total = segmentCount(found.durationSeconds);
      const counts = new Array(total).fill(0);
      let viewers = 0;
      for (const row of db.filter('progress', (item) => item.lessonId === found.id && enrolled.has(item.userId))) {
        const bits = fromHex(row.watched);
        let any = false;
        for (let segment = 0; segment < total; segment++) {
          if (hasSegment(bits, segment)) {
            counts[segment]++;
            any = true;
          }
        }
        if (any) viewers++;
      }
      detail.retention = { segmentSeconds: PROGRESS_SEGMENT_SECONDS, viewers, counts };
    }
    if (found.kind === 'quiz') {
      const quiz = db.get('quizzes', found.id);
      const attempts = db.filter('attempts', (row) => row.lessonId === found.id && enrolled.has(row.userId));
      detail.questions = (quiz?.questions ?? []).map((question) => {
        const marks = attempts.flatMap((attempt) => attempt.results.filter((result) => result.questionId === question.id));
        return { id: question.id, prompt: question.prompt, answered: marks.length, correctRate: rate(marks.filter((mark) => mark.correct).length, marks.length) };
      });
    }
    return detail;
  });
}
