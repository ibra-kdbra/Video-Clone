import { ROLE_RANK } from '@grand/contracts';
import type { SchoolContext } from '../common/request-context.js';

/** What a person may do with a course, from their school role and whether they wrote it. */
export interface CourseRow {
  id: string;
  status: 'draft' | 'published' | 'archived';
  createdBy: string | null;
}

/** Instructors and above can create courses. */
export const canCreateCourses = (school: SchoolContext) => ROLE_RANK[school.role] >= ROLE_RANK.instructor;

/** Admins and the owner edit every course; instructors edit the courses they created. */
export const canEditCourse = (school: SchoolContext, userId: string, course: Pick<CourseRow, 'createdBy'>) =>
  ROLE_RANK[school.role] >= ROLE_RANK.admin || (school.role === 'instructor' && course.createdBy === userId);

/** Members see published courses; drafts and archived courses only their editors. */
export const canSeeCourse = (school: SchoolContext, userId: string, course: CourseRow) =>
  course.status === 'published' || canEditCourse(school, userId, course);

/**
 * Watching a lesson: its editors always; members when the course and lesson are published and
 * they're enrolled, or the lesson is a free preview.
 */
export function canWatchLesson(
  school: SchoolContext,
  userId: string,
  course: CourseRow,
  lesson: { status: 'draft' | 'published'; isPreview: boolean },
  enrolled: boolean,
) {
  if (canEditCourse(school, userId, course)) return true;
  return course.status === 'published' && lesson.status === 'published' && (enrolled || lesson.isPreview);
}
