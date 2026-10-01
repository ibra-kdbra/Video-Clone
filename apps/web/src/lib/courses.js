import { apiFetch } from './session.js';

/**
 * The courses API: a school's catalog, each course with its modules and lessons, playback,
 * enrollment and video uploads. One function per endpoint, as in lms.js; every path segment that
 * comes from data is encoded, so an odd slug or id can only ever name a resource.
 */
const seg = encodeURIComponent;
const catalog = (slug) => `/schools/${seg(slug)}/courses`;
const course = (slug, courseSlug) => `${catalog(slug)}/${seg(courseSlug)}`;
const lesson = (slug, courseSlug, lessonId) => `${course(slug, courseSlug)}/lessons/${seg(lessonId)}`;

export const getCourses = (slug, signal) => apiFetch(catalog(slug), { signal });
export const createCourse = (slug, input) => apiFetch(catalog(slug), { method: 'POST', body: input });
export const getCourse = (slug, courseSlug, signal) => apiFetch(course(slug, courseSlug), { signal });
export const updateCourse = (slug, courseSlug, changes) => apiFetch(course(slug, courseSlug), { method: 'PATCH', body: changes });
export const deleteCourse = (slug, courseSlug) => apiFetch(course(slug, courseSlug), { method: 'DELETE' });

export const addModule = (slug, courseSlug, title) => apiFetch(`${course(slug, courseSlug)}/modules`, { method: 'POST', body: { title } });
export const renameModule = (slug, courseSlug, moduleId, title) =>
  apiFetch(`${course(slug, courseSlug)}/modules/${seg(moduleId)}`, { method: 'PATCH', body: { title } });
export const deleteModule = (slug, courseSlug, moduleId) => apiFetch(`${course(slug, courseSlug)}/modules/${seg(moduleId)}`, { method: 'DELETE' });
export const saveOutline = (slug, courseSlug, outline) => apiFetch(`${course(slug, courseSlug)}/outline`, { method: 'PUT', body: outline });

export const createLesson = (slug, courseSlug, input) => apiFetch(`${course(slug, courseSlug)}/lessons`, { method: 'POST', body: input });
export const getLesson = (slug, courseSlug, lessonId, signal) => apiFetch(lesson(slug, courseSlug, lessonId), { signal });
export const updateLesson = (slug, courseSlug, lessonId, changes) => apiFetch(lesson(slug, courseSlug, lessonId), { method: 'PATCH', body: changes });
export const deleteLesson = (slug, courseSlug, lessonId) => apiFetch(lesson(slug, courseSlug, lessonId), { method: 'DELETE' });
export const getPlayback = (slug, courseSlug, lessonId, signal) => apiFetch(`${lesson(slug, courseSlug, lessonId)}/playback`, { signal });

export const enroll = (slug, courseSlug) => apiFetch(`${course(slug, courseSlug)}/enrollment`, { method: 'POST' });
export const leaveCourse = (slug, courseSlug) => apiFetch(`${course(slug, courseSlug)}/enrollment`, { method: 'DELETE' });
export const getEnrollments = (slug, courseSlug, signal) => apiFetch(`${course(slug, courseSlug)}/enrollments`, { signal });
export const getStorage = (slug, signal) => apiFetch(`/schools/${seg(slug)}/storage`, { signal });

/** The upload endpoints for one lesson, in the shape the upload client (upload.js) expects. */
export function uploadEndpoints(slug, courseSlug, lessonId) {
  const base = `${lesson(slug, courseSlug, lessonId)}/upload`;
  return {
    start: (input) => apiFetch(base, { method: 'POST', body: input }),
    moreParts: (assetId, partNumbers) => apiFetch(`${base}/${seg(assetId)}/parts`, { method: 'POST', body: { partNumbers } }),
    complete: (assetId, parts) => apiFetch(`${base}/${seg(assetId)}/complete`, { method: 'POST', body: { parts } }),
    cancel: (assetId) => apiFetch(`${base}/${seg(assetId)}`, { method: 'DELETE' }),
  };
}

/** Query keys, so every page reads and updates the same cache entries. */
export const keys = {
  courses: (slug) => ['courses', slug],
  course: (slug, courseSlug) => ['course', slug, courseSlug],
  lesson: (slug, courseSlug, lessonId) => ['lesson', slug, courseSlug, lessonId],
  playback: (slug, courseSlug, lessonId) => ['playback', slug, courseSlug, lessonId],
  enrollments: (slug, courseSlug) => ['enrollments', slug, courseSlug],
  storage: (slug) => ['storage', slug],
  quiz: (slug, courseSlug, lessonId) => ['quiz', slug, courseSlug, lessonId],
  quizDraft: (slug, courseSlug, lessonId) => ['quizDraft', slug, courseSlug, lessonId],
  quizAttempt: (slug, courseSlug, lessonId, attemptId) => ['quizAttempt', slug, courseSlug, lessonId, attemptId],
  assignment: (slug, courseSlug, lessonId) => ['assignment', slug, courseSlug, lessonId],
  submissions: (slug, courseSlug, lessonId) => ['submissions', slug, courseSlug, lessonId],
  submission: (slug, courseSlug, lessonId, submissionId) => ['submission', slug, courseSlug, lessonId, submissionId],
  insights: (slug, courseSlug) => ['insights', slug, courseSlug],
  lessonInsights: (slug, courseSlug, lessonId) => ['lessonInsights', slug, courseSlug, lessonId],
};

/** Addresses in the app. */
export const coursePath = (slug, courseSlug) => `/s/${slug}/c/${courseSlug}`;
export const lessonPath = (slug, courseSlug, lessonId) => `${coursePath(slug, courseSlug)}/l/${lessonId}`;
export const editorPath = (slug, courseSlug, lessonId) => `${coursePath(slug, courseSlug)}/edit${lessonId ? `?lesson=${lessonId}` : ''}`;
export const submissionsPath = (slug, courseSlug, lessonId) => `${lessonPath(slug, courseSlug, lessonId)}/submissions`;
export const submissionPath = (slug, courseSlug, lessonId, submissionId) => `${submissionsPath(slug, courseSlug, lessonId)}/${submissionId}`;

/** A lesson's kind: a lesson (video and notes), a quiz or an assignment, with its icon. */
export const LESSON_KINDS = {
  lesson: { label: 'Lesson', icon: 'film' },
  quiz: { label: 'Quiz', icon: 'quiz' },
  assignment: { label: 'Assignment', icon: 'assignment' },
};
export const kindOf = (lesson) => LESSON_KINDS[lesson?.kind] ?? LESSON_KINDS.lesson;

/** Every lesson of a course, in outline order. */
export const lessonsOf = (course) => course?.modules?.flatMap((module) => module.lessons) ?? [];

/**
 * Where "Continue" leads: the lesson worked on most recently, or, once that one is done, the next
 * lesson not done yet after it. Null before any progress (then it's "Start").
 */
export function continueLesson(course) {
  const lessons = lessonsOf(course).filter((lesson) => !lesson.locked);
  const lastId = course?.progress?.lastLessonId;
  const index = lastId ? lessons.findIndex((lesson) => lesson.id === lastId) : -1;
  if (index === -1) return null;
  const last = lessons[index];
  if (!last.progress?.completed) return last;
  return lessons.slice(index + 1).find((lesson) => !lesson.progress?.completed) ?? last;
}

/**
 * A cached course with one lesson's new progress (a LessonProgress from the API) folded in: the
 * outline's check and bar, and the course's own count, percent and "Continue" target.
 */
export function withLessonProgress(course, lessonId, progress, now = new Date().toISOString()) {
  if (!course) return course;
  const before = lessonsOf(course).find((lesson) => lesson.id === lessonId);
  if (!before) return course;
  const newlyDone = progress.completed && !before.progress?.completed;
  const patched = patchLesson(course, lessonId, { progress: { completed: progress.completed, percent: progress.percent } });
  if (!course.progress) return patched;
  const completedLessons = Math.min(course.progress.totalLessons, course.progress.completedLessons + (newlyDone ? 1 : 0));
  return {
    ...patched,
    progress: {
      ...course.progress,
      completedLessons,
      percent: course.progress.totalLessons ? Math.round((completedLessons / course.progress.totalLessons) * 100) : 0,
      lastLessonId: lessonId,
      lastActivityAt: now,
    },
  };
}

/** Where "Start" leads: the first lesson this person may watch. */
export const firstOpenLesson = (course) => lessonsOf(course).find((item) => !item.locked) ?? null;

/** The first free preview, for people who haven't enrolled yet. */
export const firstPreview = (course) => lessonsOf(course).find((item) => item.isPreview && !item.locked) ?? null;

/** Whether an uploaded video is still on its way (uploading or transcoding). */
export const isProcessing = (video) => video?.provider === 'upload' && (video.status === 'uploading' || video.status === 'processing');

/** Changes one lesson in a cached course (from the outline's point of view). */
export function patchLesson(course, lessonId, change) {
  if (!course) return course;
  return {
    ...course,
    modules: course.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((item) => (item.id === lessonId ? { ...item, ...(typeof change === 'function' ? change(item) : change) } : item)),
    })),
  };
}
