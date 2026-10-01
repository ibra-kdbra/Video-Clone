import { COMPLETION_SHARE, PROGRESS_SEGMENT_SECONDS, ROLE_RANK } from '@grand/contracts';

/**
 * The API's rules, ported from apps/api so the demo behaves like the real thing: who may see and
 * edit what (courses/course-access.ts), watch progress as a bitset of 5-second stretches
 * (learning/segments.ts, learning/progress.ts) and quiz grading (learning/quiz-grading.ts).
 */

// Access (courses/course-access.ts) ----------------------------------------------------------------

/** True when `actor` ranks strictly above `role`. */
export const outranks = (actor, role) => ROLE_RANK[actor] > ROLE_RANK[role];

export const canCreateCourses = (school) => ROLE_RANK[school.role] >= ROLE_RANK.instructor;

/** Admins and the owner edit every course; instructors edit the courses they created. */
export const canEditCourse = (school, userId, course) => ROLE_RANK[school.role] >= ROLE_RANK.admin || (school.role === 'instructor' && course.createdBy === userId);

/** Members see published courses; drafts and archived courses only their editors. */
export const canSeeCourse = (school, userId, course) => course.status === 'published' || canEditCourse(school, userId, course);

/** Its editors always; members when the course and lesson are published and they're enrolled, or it's a free preview. */
export function canWatchLesson(school, userId, course, lesson, enrolled) {
  if (canEditCourse(school, userId, course)) return true;
  return course.status === 'published' && lesson.status === 'published' && (enrolled || lesson.isPreview);
}

// Watch progress (learning/segments.ts) ------------------------------------------------------------

/** How many stretches a video of this length has (at least one). */
export const segmentCount = (durationSeconds) => Math.max(1, Math.ceil(durationSeconds / PROGRESS_SEGMENT_SECONDS));

/** The bitset (most significant bit of the first byte first) from its hex form, as stored. */
export const fromHex = (hex = '') => Uint8Array.from((hex ?? '').match(/../g) ?? [], (pair) => parseInt(pair, 16));
export const toHex = (bits) => Array.from(bits, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** The bits with these stretches set. Stretches past the end of the video are ignored. */
export function markSegments(current, segments, total) {
  const bits = new Uint8Array(Math.ceil(total / 8));
  bits.set(current.subarray(0, Math.min(current.length, bits.length)));
  for (const segment of segments) {
    if (!Number.isInteger(segment) || segment < 0 || segment >= total) continue;
    bits[segment >> 3] |= 0x80 >> (segment & 7);
  }
  // Bits beyond the video's end (left over if it got shorter) aren't counted.
  if (total % 8 && bits.length) bits[bits.length - 1] &= (0xff << (8 - (total % 8))) & 0xff;
  return bits;
}

export const hasSegment = (bits, segment) => segment >> 3 < bits.length && (bits[segment >> 3] & (0x80 >> (segment & 7))) !== 0;

/** How many of the first `total` stretches are set. */
export function countSegments(bits, total) {
  let count = 0;
  for (let segment = 0; segment < total; segment++) if (hasSegment(bits, segment)) count++;
  return count;
}

/** Whether these watched stretches complete an uploaded video (90% of it). */
export const completesVideo = (bits, total) => total > 0 && countSegments(bits, total) >= Math.ceil(total * COMPLETION_SHARE);

// Progress (learning/progress.ts) ------------------------------------------------------------------

const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

/** How far into a lesson someone is: 100 once completed, else the share of its video watched. */
export function lessonPercent(lesson, row) {
  if (!row) return 0;
  if (row.completedAt) return 100;
  if (lesson.videoProvider === 'upload' && lesson.durationSeconds) {
    return Math.min(99, Math.floor((row.watchedSeconds / lesson.durationSeconds) * 100));
  }
  return 0;
}

export const progressSummary = (lesson, row) => ({ completed: Boolean(row?.completedAt), percent: lessonPercent(lesson, row) });

export const lessonProgressDetail = (lesson, row) => ({
  lessonId: lesson.id,
  completed: Boolean(row?.completedAt),
  completedAt: iso(row?.completedAt),
  percent: lessonPercent(lesson, row),
  positionSeconds: row?.positionSeconds ?? 0,
});

/** Progress through a course's published lessons, from the person's progress rows. */
export function courseProgress(publishedLessonIds, rows) {
  const published = new Set(publishedLessonIds);
  const relevant = rows.filter((row) => published.has(row.lessonId));
  const completedLessons = relevant.filter((row) => row.completedAt).length;
  const latest = relevant.reduce((best, row) => (!best || row.updatedAt > best.updatedAt ? row : best), undefined);
  return {
    completedLessons,
    totalLessons: published.size,
    percent: published.size ? Math.round((completedLessons / published.size) * 100) : 0,
    lastLessonId: latest?.lessonId ?? null,
    lastActivityAt: iso(latest?.updatedAt),
  };
}

// Quizzes (learning/quiz-grading.ts) ---------------------------------------------------------------

/** Short answers are compared without regard to case, accents, spacing or a final full stop. */
export function normalizeAnswer(text) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .trim();
}

/** The questions as stored, with ids for every question and choice (kept when sent back, new otherwise). */
export function storeQuestions(input, newId) {
  const used = new Set();
  const idFor = (proposed) => {
    const id = proposed && !used.has(proposed) ? proposed : newId();
    used.add(id);
    return id;
  };
  return input.map((question) => ({
    id: idFor(question.id),
    kind: question.kind,
    prompt: question.prompt,
    explanation: question.explanation,
    points: question.points,
    options: question.kind === 'short' ? [] : question.options.map((option) => ({ id: idFor(option.id), label: option.label, correct: option.correct })),
    answers: question.kind === 'short' ? question.answers : [],
  }));
}

/**
 * Marks an attempt. A choice question is right only with exactly the right choices (no partial
 * credit for "multiple"); a short answer is right when it matches an accepted one.
 */
export function gradeQuiz(questions, answers) {
  const results = questions.map((question) => {
    const answer = answers[question.id];
    let correct = false;
    if (question.kind === 'short') {
      correct = typeof answer === 'string' && question.answers.some((accepted) => normalizeAnswer(accepted) === normalizeAnswer(answer));
    } else if (Array.isArray(answer)) {
      const chosen = new Set(answer);
      const right = question.options.filter((option) => option.correct).map((option) => option.id);
      correct = chosen.size === right.length && right.every((id) => chosen.has(id)) && (question.kind === 'multiple' || chosen.size === 1);
    }
    return { questionId: question.id, correct, points: correct ? question.points : 0, maxPoints: question.points };
  });
  const score = results.reduce((sum, result) => sum + result.points, 0);
  const maxScore = results.reduce((sum, result) => sum + result.maxPoints, 0);
  return { results, score, maxScore, percent: maxScore ? Math.round((score / maxScore) * 100) : 0 };
}

/** What someone taking the quiz may see of a question. */
export const forTaker = (question) => ({
  id: question.id,
  kind: question.kind,
  prompt: question.prompt,
  points: question.points,
  options: question.options.map(({ id, label }) => ({ id, label })),
});

export const forEditor = (question) => ({
  id: question.id,
  kind: question.kind,
  prompt: question.prompt,
  explanation: question.explanation,
  points: question.points,
  options: question.options,
  answers: question.answers,
});

// Small helpers ------------------------------------------------------------------------------------

/** "Intro to Música!" → "intro-to-musica" (courses/slugify.ts). */
export function slugify(text, maxLength = 60) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}

/** a***@example.com (schools/invitations.service.ts). */
export function maskEmail(email) {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domain}`;
}

/** 8 → "8", 8.5 → "8.5" (the worker's formatPoints). */
export const formatPoints = (points) => (Number.isInteger(points) ? String(points) : points.toFixed(2).replace(/0+$/, ''));

/** "1.5 GB", "120 MB" (storage/quota.ts). */
export const formatSize = (bytes) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(bytes < 10 * 1024 ** 3 ? 1 : 0)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;

export { iso };
