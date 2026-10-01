import { keys, withLessonProgress } from './courses.js';
import { apiFetch, apiFetchKeepalive } from './session.js';

/**
 * The learning API (Phase 2): watch progress and completion, quizzes, assignments with their
 * submissions and files, and insights for a course's editors. One function per endpoint, as in
 * courses.js; every path segment that comes from data is encoded.
 */
const seg = encodeURIComponent;
const course = (slug, courseSlug) => `/schools/${seg(slug)}/courses/${seg(courseSlug)}`;
const lesson = (slug, courseSlug, lessonId) => `${course(slug, courseSlug)}/lessons/${seg(lessonId)}`;
const assignment = (slug, courseSlug, lessonId) => `${lesson(slug, courseSlug, lessonId)}/assignment`;

// Progress ---------------------------------------------------------------------------------------

export const progressPath = (slug, courseSlug, lessonId) => `${lesson(slug, courseSlug, lessonId)}/progress`;
export const recordProgress = (slug, courseSlug, lessonId, input) => apiFetch(progressPath(slug, courseSlug, lessonId), { method: 'PUT', body: input });
/** The same, as the page is hidden or closed (see apiFetchKeepalive). */
export const recordProgressOnExit = (slug, courseSlug, lessonId, input) =>
  apiFetchKeepalive(progressPath(slug, courseSlug, lessonId), { method: 'PUT', body: input });
export const completeLesson = (slug, courseSlug, lessonId) => apiFetch(`${lesson(slug, courseSlug, lessonId)}/complete`, { method: 'POST' });

/**
 * Folds a lesson's new progress (LessonProgress) into everything cached about it: the lesson, the
 * course's outline and counts, and (marked stale) the school's catalog.
 */
export function applyProgress(queryClient, slug, courseSlug, lessonId, progress) {
  queryClient.setQueryData(keys.lesson(slug, courseSlug, lessonId), (current) =>
    current && { ...current, progressDetail: progress, progress: { completed: progress.completed, percent: progress.percent } },
  );
  queryClient.setQueryData(keys.course(slug, courseSlug), (current) => withLessonProgress(current, lessonId, progress));
  queryClient.invalidateQueries({ queryKey: keys.courses(slug), refetchType: 'none' });
}

// Quizzes ----------------------------------------------------------------------------------------

export const getQuiz = (slug, courseSlug, lessonId, signal) => apiFetch(`${lesson(slug, courseSlug, lessonId)}/quiz`, { signal });
export const getQuizDraft = (slug, courseSlug, lessonId, signal) => apiFetch(`${lesson(slug, courseSlug, lessonId)}/quiz/draft`, { signal });
export const saveQuiz = (slug, courseSlug, lessonId, input) => apiFetch(`${lesson(slug, courseSlug, lessonId)}/quiz`, { method: 'PUT', body: input });
export const attemptQuiz = (slug, courseSlug, lessonId, input) =>
  apiFetch(`${lesson(slug, courseSlug, lessonId)}/quiz/attempts`, { method: 'POST', body: input });
export const getQuizAttempt = (slug, courseSlug, lessonId, attemptId, signal) =>
  apiFetch(`${lesson(slug, courseSlug, lessonId)}/quiz/attempts/${encodeURIComponent(attemptId)}`, { signal });

// Assignments ------------------------------------------------------------------------------------

export const getAssignment = (slug, courseSlug, lessonId, signal) => apiFetch(assignment(slug, courseSlug, lessonId), { signal });
export const configureAssignment = (slug, courseSlug, lessonId, input) => apiFetch(assignment(slug, courseSlug, lessonId), { method: 'PUT', body: input });

export const saveSubmission = (slug, courseSlug, lessonId, body) =>
  apiFetch(`${assignment(slug, courseSlug, lessonId)}/submission`, { method: 'PUT', body: { body } });
/** The written answer's last save, as the page is hidden or closed. */
export const saveSubmissionOnExit = (slug, courseSlug, lessonId, body) =>
  apiFetchKeepalive(`${assignment(slug, courseSlug, lessonId)}/submission`, { method: 'PUT', body: { body } });
export const submitAssignment = (slug, courseSlug, lessonId) => apiFetch(`${assignment(slug, courseSlug, lessonId)}/submission/submit`, { method: 'POST' });

/** The file endpoints of the viewer's own submission, in the shape uploadSubmissionFile expects. */
export function submissionFileEndpoints(slug, courseSlug, lessonId) {
  const base = `${assignment(slug, courseSlug, lessonId)}/submission/files`;
  return {
    start: (input) => apiFetch(base, { method: 'POST', body: input }),
    complete: (fileId) => apiFetch(`${base}/${seg(fileId)}/complete`, { method: 'POST' }),
    remove: (fileId) => apiFetch(`${base}/${seg(fileId)}`, { method: 'DELETE' }),
  };
}

export const getSubmissions = (slug, courseSlug, lessonId, signal) => apiFetch(`${assignment(slug, courseSlug, lessonId)}/submissions`, { signal });
export const getSubmission = (slug, courseSlug, lessonId, submissionId, signal) =>
  apiFetch(`${assignment(slug, courseSlug, lessonId)}/submissions/${seg(submissionId)}`, { signal });
export const gradeSubmission = (slug, courseSlug, lessonId, submissionId, input) =>
  apiFetch(`${assignment(slug, courseSlug, lessonId)}/submissions/${seg(submissionId)}/grade`, { method: 'POST', body: input });
const getDownload = (slug, courseSlug, lessonId, submissionId, fileId) =>
  apiFetch(`${assignment(slug, courseSlug, lessonId)}/submissions/${seg(submissionId)}/files/${seg(fileId)}`);

/**
 * Downloads a handed-in file: the API signs a short-lived address that the store serves as an
 * attachment, so going to it saves the file and leaves this page where it is.
 */
export async function downloadSubmissionFile(slug, courseSlug, lessonId, submissionId, fileId) {
  const { url } = await getDownload(slug, courseSlug, lessonId, submissionId, fileId);
  window.location.assign(url);
}

// Insights ---------------------------------------------------------------------------------------

export const getCourseInsights = (slug, courseSlug, signal) => apiFetch(`${course(slug, courseSlug)}/insights`, { signal });
export const getLessonInsights = (slug, courseSlug, lessonId, signal) => apiFetch(`${lesson(slug, courseSlug, lessonId)}/insights`, { signal });
