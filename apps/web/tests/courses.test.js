import { describe, expect, it } from 'vitest';

import { continueLesson, kindOf, lessonsOf, withLessonProgress } from '../src/lib/courses.js';

const lesson = (id, done = false, extra = {}) => ({ id, title: id, locked: false, progress: { completed: done, percent: done ? 100 : 0 }, ...extra });
const course = (lessons, progress) => ({
  id: 'c1',
  modules: [
    { id: 'm1', lessons: lessons.slice(0, 2) },
    { id: 'm2', lessons: lessons.slice(2) },
  ],
  progress,
});
const progress = (lastLessonId, completedLessons = 0, totalLessons = 4) => ({
  completedLessons,
  totalLessons,
  percent: Math.round((completedLessons / totalLessons) * 100),
  lastLessonId,
  lastActivityAt: lastLessonId ? '2026-09-30T10:00:00.000Z' : null,
});

describe('continueLesson', () => {
  it('is nothing before any progress (that’s "Start")', () => {
    expect(continueLesson(course([lesson('a'), lesson('b')], progress(null)))).toBeNull();
    expect(continueLesson(course([lesson('a')], null))).toBeNull();
  });

  it('leads to the lesson worked on last, while it isn’t done', () => {
    expect(continueLesson(course([lesson('a', true), lesson('b'), lesson('c')], progress('b', 1)))?.id).toBe('b');
  });

  it('moves on to the next lesson not done yet once the last one is done', () => {
    const c = course([lesson('a', true), lesson('b', true), lesson('c', true), lesson('d')], progress('a', 3));
    expect(continueLesson(c)?.id).toBe('d');
    // Everything after it done: back to the last one.
    const all = course([lesson('a'), lesson('b', true)], progress('b', 1, 2));
    expect(continueLesson(all)?.id).toBe('b');
  });

  it('ignores a last lesson that is gone or locked', () => {
    expect(continueLesson(course([lesson('a'), lesson('b')], progress('gone')))).toBeNull();
    expect(continueLesson(course([lesson('a', false, { locked: true })], progress('a')))).toBeNull();
  });
});

describe('withLessonProgress', () => {
  it('checks the lesson off and counts it once for the course', () => {
    const before = course([lesson('a', true), lesson('b'), lesson('c'), lesson('d')], progress('a', 1));
    const done = { lessonId: 'b', completed: true, completedAt: 'x', percent: 100, positionSeconds: 20 };
    const after = withLessonProgress(before, 'b', done, 'NOW');
    expect(lessonsOf(after).find((item) => item.id === 'b').progress).toEqual({ completed: true, percent: 100 });
    expect(after.progress).toEqual({ completedLessons: 2, totalLessons: 4, percent: 50, lastLessonId: 'b', lastActivityAt: 'NOW' });
    // Reported again: still two.
    expect(withLessonProgress(after, 'b', done, 'LATER').progress.completedLessons).toBe(2);
  });

  it('moves the bar and "Continue" without completing', () => {
    const before = course([lesson('a'), lesson('b')], progress(null, 0, 2));
    const after = withLessonProgress(before, 'a', { lessonId: 'a', completed: false, completedAt: null, percent: 40, positionSeconds: 9 }, 'NOW');
    expect(lessonsOf(after)[0].progress).toEqual({ completed: false, percent: 40 });
    expect(after.progress).toMatchObject({ completedLessons: 0, percent: 0, lastLessonId: 'a' });
  });

  it('leaves courses without progress (not enrolled) and unknown lessons alone', () => {
    const plain = course([lesson('a')], null);
    expect(withLessonProgress(plain, 'a', { completed: true, percent: 100 }).progress).toBeNull();
    expect(withLessonProgress(plain, 'zz', { completed: true, percent: 100 })).toBe(plain);
    expect(withLessonProgress(undefined, 'a', {})).toBeUndefined();
  });
});

describe('kindOf', () => {
  it('names each kind of lesson, with lessons as the default', () => {
    expect(kindOf({ kind: 'quiz' })).toEqual({ label: 'Quiz', icon: 'quiz' });
    expect(kindOf({ kind: 'assignment' }).label).toBe('Assignment');
    expect(kindOf({}).label).toBe('Lesson');
  });
});
