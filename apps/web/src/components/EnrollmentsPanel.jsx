import { useQuery } from '@tanstack/react-query';

import { getEnrollments, keys } from '../lib/courses.js';
import { formatDate } from '../lib/format.js';
import Monogram from './Monogram.jsx';
import { Block } from './Skeleton.jsx';
import { EmptyState, ErrorState } from './States.jsx';
import styles from './EnrollmentsPanel.module.scss';

/** Who is enrolled in the course, newest first (for its editors). */
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
      {enrollments.data.map((person) => (
        <li key={person.userId} className={styles.item}>
          <Monogram name={person.name} seed={person.userId} size={40} letters={1} round />
          <div className={styles.who}>
            <p className={styles.name}>{person.name}</p>
            <p className={styles.email}>{person.email}</p>
          </div>
          <p className={styles.date}>Enrolled {formatDate(person.enrolledAt)}</p>
        </li>
      ))}
    </ul>
  );
}
