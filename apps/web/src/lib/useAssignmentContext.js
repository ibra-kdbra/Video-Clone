import { useQuery } from '@tanstack/react-query';

import { getCourse, getLesson, keys } from './courses.js';
import { getAssignment, getSubmissions } from './learning.js';

const noRetryOn4xx = (failures, error) => failures < 1 && (error?.status === 0 || error?.status >= 500);

/**
 * What the submissions list and the grading page both need: the course, the lesson, the
 * assignment (its points and counts) and its handed-in submissions, waiting ones first.
 */
export function useAssignmentContext(slug, courseSlug, lessonId) {
  const course = useQuery({ queryKey: keys.course(slug, courseSlug), queryFn: ({ signal }) => getCourse(slug, courseSlug, signal), staleTime: 30_000, retry: noRetryOn4xx });
  const lesson = useQuery({
    queryKey: keys.lesson(slug, courseSlug, lessonId),
    queryFn: ({ signal }) => getLesson(slug, courseSlug, lessonId, signal),
    staleTime: 30_000,
    retry: noRetryOn4xx,
  });
  const assignment = useQuery({
    queryKey: keys.assignment(slug, courseSlug, lessonId),
    queryFn: ({ signal }) => getAssignment(slug, courseSlug, lessonId, signal),
    staleTime: 30_000,
    retry: noRetryOn4xx,
  });
  const submissions = useQuery({
    queryKey: keys.submissions(slug, courseSlug, lessonId),
    queryFn: ({ signal }) => getSubmissions(slug, courseSlug, lessonId, signal),
    staleTime: 15_000,
    retry: noRetryOn4xx,
  });
  return { course, lesson, assignment, submissions };
}
