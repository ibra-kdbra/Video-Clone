import type { CourseProgress, LessonProgress, LessonProgressSummary } from '@grand/contracts';
import type { lessonProgress, lessons } from '../database/schema.js';

export type ProgressRow = typeof lessonProgress.$inferSelect;
type LessonFields = Pick<typeof lessons.$inferSelect, 'id' | 'durationSeconds' | 'videoProvider'>;

/** How far into a lesson someone is: 100 once completed, else the share of its video watched. */
export function lessonPercent(lesson: LessonFields, row: ProgressRow | undefined): number {
  if (!row) return 0;
  if (row.completedAt) return 100;
  if (lesson.videoProvider === 'upload' && lesson.durationSeconds) {
    // Not completed is never shown as 100.
    return Math.min(99, Math.floor((row.watchedSeconds / lesson.durationSeconds) * 100));
  }
  return 0;
}

export const progressSummary = (lesson: LessonFields, row: ProgressRow | undefined): LessonProgressSummary => ({
  completed: Boolean(row?.completedAt),
  percent: lessonPercent(lesson, row),
});

export const lessonProgressDetail = (lesson: LessonFields, row: ProgressRow | undefined): LessonProgress => ({
  lessonId: lesson.id,
  completed: Boolean(row?.completedAt),
  completedAt: row?.completedAt?.toISOString() ?? null,
  percent: lessonPercent(lesson, row),
  positionSeconds: row?.positionSeconds ?? 0,
});

/** Progress through a course's published lessons, from the person's progress rows. */
export function courseProgress(publishedLessonIds: string[], rows: ProgressRow[]): CourseProgress {
  const published = new Set(publishedLessonIds);
  const relevant = rows.filter((row) => published.has(row.lessonId));
  const completedLessons = relevant.filter((row) => row.completedAt).length;
  const latest = relevant.reduce<ProgressRow | undefined>((best, row) => (!best || row.updatedAt > best.updatedAt ? row : best), undefined);
  return {
    completedLessons,
    totalLessons: published.size,
    percent: published.size ? Math.round((completedLessons / published.size) * 100) : 0,
    lastLessonId: latest?.lessonId ?? null,
    lastActivityAt: latest?.updatedAt.toISOString() ?? null,
  };
}
