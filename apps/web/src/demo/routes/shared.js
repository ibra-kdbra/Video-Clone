import { HttpError, forbidden, notFound } from '../http.js';
import { ids } from '../seed.js';
import { canEditCourse, canSeeCourse, canWatchLesson, courseProgress, iso, lessonProgressDetail, progressSummary } from '../logic.js';

/**
 * What the courses and learning routes share, ported from apps/api/src/courses: finding a course
 * or lesson the caller may see (drafts are "not found" to everyone but their editors), and the
 * views of courses and lessons the API returns.
 */

export const enrollmentRequired = (message = 'Enroll in this course to watch this lesson.') => new HttpError(403, 'enrollment_required', message);

/** The course with this address, if the viewer may see it; otherwise "not found", drafts included. */
export function findVisible(ctx, courseSlug) {
  const course = ctx.db.find('courses', (row) => row.schoolId === ctx.school.id && row.slug === courseSlug);
  if (!course || !canSeeCourse(ctx.school, ctx.auth.userId, course)) throw notFound('This course');
  return course;
}

/** As findVisible, but the viewer must be able to edit it. */
export function findEditable(ctx, courseSlug) {
  const course = findVisible(ctx, courseSlug);
  if (!canEditCourse(ctx.school, ctx.auth.userId, course)) throw forbidden('Only the course author or a school admin can change this course.');
  return course;
}

/** The lesson, if it belongs to the course and the viewer may see it in the outline. */
export function findLesson(ctx, course, lessonId) {
  const lesson = ctx.db.get('lessons', lessonId);
  if (!lesson || lesson.courseId !== course.id || (lesson.status !== 'published' && !canEditCourse(ctx.school, ctx.auth.userId, course))) throw notFound('This lesson');
  return lesson;
}

export const isEnrolled = (db, courseId, userId) => Boolean(db.get('enrollments', `${courseId}:${userId}`));

/** Modules in order, and each one's lessons in order. */
export function outline(db, course) {
  const modules = db.filter('modules', (row) => row.courseId === course.id).sort((a, b) => a.position - b.position);
  const lessons = db.filter('lessons', (row) => row.courseId === course.id).sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
  return { modules, lessons };
}

/** The lessons in outline order (module, then position). */
export function lessonsInOrder(db, course) {
  const { modules, lessons } = outline(db, course);
  return modules.flatMap((module) => lessons.filter((lesson) => lesson.moduleId === module.id));
}

/** A lesson's video as the outline shows it. Demo uploads are always ready. */
export function lessonVideo(lesson) {
  if (lesson.videoProvider === 'upload' && lesson.mediaKey) return { provider: 'upload', assetId: ids.media(lesson.mediaKey), status: 'ready', progress: 100, error: null };
  if (lesson.videoProvider && lesson.videoProvider !== 'upload' && lesson.videoRef) return { provider: lesson.videoProvider, ref: lesson.videoRef };
  return null;
}

export const toLessonSummary = (lesson, locked, progress = null) => ({
  id: lesson.id,
  moduleId: lesson.moduleId,
  kind: lesson.kind,
  title: lesson.title,
  summary: lesson.summary,
  status: lesson.status,
  isPreview: lesson.isPreview,
  durationSeconds: lesson.durationSeconds ?? null,
  video: lessonVideo(lesson),
  locked,
  progress,
});

/** A course's cover: its YouTube video's picture, or a poster of the school's own video. */
export function coverUrl(course) {
  if (course.cover?.youtube) return `https://i.ytimg.com/vi/${course.cover.youtube}/hqdefault.jpg`;
  if (course.cover?.media) return `/demo/media/${course.cover.media}/poster.jpg`;
  return null;
}

export const summaryFields = (course) => ({
  id: course.id,
  slug: course.slug,
  title: course.title,
  summary: course.summary,
  status: course.status,
  coverUrl: coverUrl(course),
  createdAt: iso(course.createdAt),
  publishedAt: iso(course.publishedAt),
});

/** The person's progress rows in a course. */
export const progressRows = (db, courseId, userId) => db.filter('progress', (row) => row.courseId === courseId && row.userId === userId);

/** The full course view for this viewer (CoursesService.describe). */
export function describeCourse(ctx, course) {
  const { db, school, auth } = ctx;
  const editor = canEditCourse(school, auth.userId, course);
  const { modules, lessons } = outline(db, course);
  const visibleLessons = editor ? lessons : lessons.filter((lesson) => lesson.status === 'published');
  const enrolled = isEnrolled(db, course.id, auth.userId);
  const rows = progressRows(db, course.id, auth.userId);
  const byLesson = new Map(rows.map((row) => [row.lessonId, row]));
  const author = course.createdBy ? db.get('users', course.createdBy) : null;
  const described = modules.map((module) => ({
    id: module.id,
    title: module.title,
    lessons: visibleLessons
      .filter((lesson) => lesson.moduleId === module.id)
      .map((lesson) => toLessonSummary(lesson, !canWatchLesson(school, auth.userId, course, lesson, enrolled), enrolled ? progressSummary(lesson, byLesson.get(lesson.id)) : null)),
  }));
  const visibleModules = editor ? described : described.filter((module) => module.lessons.length > 0);
  const all = visibleModules.flatMap((module) => module.lessons);
  return {
    ...summaryFields(course),
    lessonCount: all.length,
    durationSeconds: all.reduce((sum, lesson) => sum + (lesson.durationSeconds ?? 0), 0),
    enrolled,
    progress: enrolled
      ? courseProgress(
          lessons.filter((lesson) => lesson.status === 'published').map((lesson) => lesson.id),
          rows,
        )
      : null,
    description: course.description,
    createdBy: author ? { id: author.id, name: author.name } : null,
    enrollmentCount: db.count('enrollments', (row) => row.courseId === course.id),
    canEdit: editor,
    modules: visibleModules,
  };
}

/** A lesson with its notes and neighbours (LessonsService.describe). */
export function describeLesson(ctx, course, lesson, enrolled) {
  const { db, school, auth } = ctx;
  const editor = canEditCourse(school, auth.userId, course);
  const order = lessonsInOrder(db, course).filter((row) => editor || row.status === 'published');
  const index = order.findIndex((row) => row.id === lesson.id);
  const progress = enrolled ? db.get('progress', `${lesson.id}:${auth.userId}`) : null;
  const neighbour = (row) => (row ? { id: row.id, title: row.title } : null);
  return {
    ...toLessonSummary(lesson, !canWatchLesson(school, auth.userId, course, lesson, enrolled || editor), enrolled ? progressSummary(lesson, progress ?? undefined) : null),
    courseId: course.id,
    notes: lesson.notes,
    progressDetail: enrolled ? lessonProgressDetail(lesson, progress ?? undefined) : null,
    previous: index > 0 ? neighbour(order[index - 1]) : null,
    next: index >= 0 && index < order.length - 1 ? neighbour(order[index + 1]) : null,
  };
}

/** This person's progress row for a lesson, created if needed (ProgressService.lockRow). */
export function progressRow(ctx, lesson, userId) {
  const id = `${lesson.id}:${userId}`;
  return (
    ctx.db.get('progress', id) ??
    ctx.db.put('progress', {
      id,
      schoolId: lesson.schoolId,
      courseId: lesson.courseId,
      lessonId: lesson.id,
      userId,
      watched: '',
      watchedSeconds: 0,
      positionSeconds: 0,
      completedAt: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
  );
}

/** Sets a lesson completed for this person (passing a quiz, handing in an assignment). */
export function markCompleted(ctx, lesson, userId) {
  const row = progressRow(ctx, lesson, userId);
  return ctx.db.update('progress', row.id, { completedAt: row.completedAt ?? ctx.now, updatedAt: ctx.now });
}

/** Removes everything that hangs off these lessons: progress, attempts, submissions and their files, comments. */
export function removeLessonData(db, lessonIds) {
  const set = new Set(lessonIds);
  const comments = new Set(db.filter('posts', (row) => set.has(row.lessonId)).map((row) => row.id));
  db.removeWhere('votes', (row) => comments.has(row.postId));
  db.removeWhere('reports', (row) => comments.has(row.postId));
  db.removeWhere('posts', (row) => comments.has(row.id));
  const submissions = db.filter('submissions', (row) => set.has(row.lessonId)).map((row) => row.id);
  const subs = new Set(submissions);
  db.removeWhere('files', (row) => subs.has(row.submissionId));
  db.removeWhere('submissions', (row) => subs.has(row.id));
  db.removeWhere('progress', (row) => set.has(row.lessonId));
  db.removeWhere('attempts', (row) => set.has(row.lessonId));
  for (const id of set) {
    db.remove('quizzes', id);
    db.remove('assignments', id);
    db.remove('lessons', id);
  }
}
