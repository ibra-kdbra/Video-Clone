import { createStore, useStore } from './store.js';

/**
 * Where this person is in each course, kept in this browser only (a convenience, like the video
 * history): the last lesson opened per course, for "Continue", and how far into each lesson's
 * video they got, to resume there and to mark lessons as watched.
 */
const LIMIT = 300;
const ID = /^[0-9a-f-]{36}$/i;

const num = (value) => (Number.isFinite(value) && value >= 0 ? value : null);

function read(value) {
  const courses = {};
  const lessons = {};
  for (const [courseId, entry] of Object.entries(value?.courses ?? {})) {
    if (ID.test(courseId) && ID.test(entry?.lessonId ?? '') && num(entry.at) !== null) {
      courses[courseId] = { lessonId: entry.lessonId, title: typeof entry.title === 'string' ? entry.title.slice(0, 200) : '', at: entry.at };
    }
  }
  for (const [lessonId, entry] of Object.entries(value?.lessons ?? {})) {
    if (ID.test(lessonId) && num(entry?.t) !== null && num(entry.at) !== null) lessons[lessonId] = { t: entry.t, d: num(entry.d), at: entry.at };
  }
  return { courses, lessons };
}

const store = createStore('grand.progress', read, { courses: {}, lessons: {} });

/** Keeps the newest `LIMIT` entries of a map of `{ at }` records. */
function newest(map) {
  const list = Object.entries(map);
  if (list.length <= LIMIT) return map;
  return Object.fromEntries(list.sort((a, b) => b[1].at - a[1].at).slice(0, LIMIT));
}

export const useProgress = () => useStore(store);

export function rememberLesson(courseId, lesson) {
  store.set((state) => ({ ...state, courses: newest({ ...state.courses, [courseId]: { lessonId: lesson.id, title: lesson.title, at: Date.now() } }) }));
}

export function savePosition(lessonId, seconds, duration) {
  if (!Number.isFinite(seconds)) return;
  store.set((state) => ({ ...state, lessons: newest({ ...state.lessons, [lessonId]: { t: Math.round(seconds), d: num(duration), at: Date.now() } }) }));
}

/** Watched to (nearly) the end. */
export const isWatched = (entry) => Boolean(entry?.d) && entry.t >= entry.d - Math.min(15, entry.d * 0.1);

/** Where to resume a lesson's video: null near the start or the end. */
export function resumePoint(entry) {
  if (!entry || entry.t < 5 || isWatched(entry)) return null;
  return entry.t;
}

/** How far into a lesson (0 to 1), for the thin bar under it. */
export const watchedShare = (entry) => (entry?.d ? Math.min(1, entry.t / entry.d) : 0);
