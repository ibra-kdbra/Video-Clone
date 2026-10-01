import { useQuery } from '@tanstack/react-query';

import { getEnrollments, keys } from '../lib/courses.js';
import { formatDate, lastActive } from '../lib/format.js';
import Monogram from './Monogram.jsx';
import ProgressBar from './ProgressBar.jsx';
import { Block } from './Skeleton.jsx';
import { EmptyState, ErrorState } from './States.jsx';
import styles from './EnrollmentsPanel.module.scss';

/**
 * Who is enrolled in the course, newest first (for its editors), with how far each has got:
 * a bar, the lessons completed of those published, and when they were last active.
 */
export default function EnrollmentsPanel({ school, course }) {
  const enrollments = useQuery({
    queryKey: keys.enrollments(school.slug, course.slug),
    queryFn: ({ signal }) => getEnrollments(school.slug, course.slug, signal),
    staleTime: 30_000,
  });

  if (enrollments.isError) return <ErrorState error={enrollments.error} onRetry={() => enrollments.refetch()} />;
  if (enrollments.isPending)
    return (
      <ul className={styles.list} aria-busy="true">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={i} className={styles.item} aria-hidden="true">
            <Block width="40px" height="40px" radius="50%" />
            <div className={styles.who}>
              <Block width="40%" height="0.95rem" />
              <Block width="60%" height="0.8rem" />
            </div>
          </li>
        ))}
      </ul>
    );
  if (enrollments.data.length === 0)
    return (
      <EmptyState icon="users" title="No students yet" titleAs="h3">
        {course.status === 'published'
          ? 'Members of the school enroll from the course page.'
          : 'Once the course is published, members of the school can enroll from its page.'}
      </EmptyState>
    );

  return (
    <ul className={styles.list}>
      {enrollments.data.map((person) => {
        const progress = person.progress;
        const done = progress && progress.totalLessons > 0 && progress.completedLessons >= progress.totalLessons;
        return (
          <li key={person.userId} className={styles.item}>
            <Monogram name={person.name} seed={person.userId} size={40} letters={1} round />
            <div className={styles.who}>
              <p className={styles.name}>{person.name}</p>
              <p className={styles.email}>{person.email}</p>
            </div>
            {progress && (
              <div className={styles.progress}>
                <p className={`${styles.progressText} tabular`}>
                  <span>
                    {progress.completedLessons}/{progress.totalLessons} lessons
                  </span>
                  <span className={styles.percent}>{progress.percent}%</span>
                </p>
                <ProgressBar
                  value={progress.percent}
                  tone={done ? 'success' : 'accent'}
                  label={`${person.name}'s progress`}
                  valueText={`${progress.percent}%: ${progress.completedLessons} of ${progress.totalLessons} lessons completed`}
                />
              </div>
            )}
            <div className={styles.dates}>
              <p className={styles.active}>{progress ? lastActive(progress.lastActivityAt) : ''}</p>
              <p className={styles.date}>Enrolled {formatDate(person.enrolledAt)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
