import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getCourses, keys } from '../lib/courses.js';
import { useProgress } from '../lib/progress.js';
import { canCreateCourses, isManager } from '../lib/roles.js';
import Button from './Button.jsx';
import CourseCard, { CourseCardSkeleton } from './CourseCard.jsx';
import { EmptyState, ErrorState } from './States.jsx';
import styles from './CourseCatalog.module.scss';

/** A titled group of course cards. `shelf` swipes sideways on phones, like a streaming row. */
function Section({ title, note, count, shelf = false, children }) {
  const headingId = useId();
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          {title}
          {count > 0 && <span className={`${styles.count} tabular`}>{count}</span>}
        </h2>
        {note && <p className={styles.note}>{note}</p>}
      </header>
      <ul className={shelf ? styles.shelf : styles.grid}>{children}</ul>
    </section>
  );
}

/**
 * A school's courses, the heart of its page. Students see "Continue learning" (the courses they're
 * enrolled in, most recently watched first) and then every published course. Instructors and
 * admins also see the drafts and archived courses they can edit, each marked as such. Every state
 * has a next step: an empty school invites its instructors to create the first course.
 */
export default function CourseCatalog({ school, onNewCourse }) {
  const progress = useProgress();
  const creator = canCreateCourses(school.role);
  const courses = useQuery({
    queryKey: keys.courses(school.slug),
    queryFn: ({ signal }) => getCourses(school.slug, signal),
    staleTime: 30_000,
  });

  if (courses.isPending)
    return (
      <div className={styles.catalog} aria-busy="true">
        <p className="visually-hidden" role="status">
          Loading courses…
        </p>
        <ul className={styles.grid} aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i}>
              <CourseCardSkeleton />
            </li>
          ))}
        </ul>
      </div>
    );
  if (courses.isError) return <ErrorState title="Couldn't load the courses" error={courses.error} onRetry={() => courses.refetch()} />;

  const list = courses.data;
  const lastSeen = (course) => progress.courses[course.id]?.at ?? 0;
  const published = list.filter((course) => course.status === 'published');
  const enrolled = published.filter((course) => course.enrolled).sort((a, b) => lastSeen(b) - lastSeen(a));
  const unpublished = list.filter((course) => course.status !== 'published');

  if (list.length === 0)
    return creator ? (
      <EmptyState
        icon="layers"
        title="Create the first course"
        action={
          <Button variant="primary" icon="plus" onClick={onNewCourse}>
            New course
          </Button>
        }
      >
        Courses hold modules of video lessons. Start with a title; you can add lessons, upload videos and publish when it's ready.
      </EmptyState>
    ) : (
      <EmptyState icon="layers" title="No courses yet">
        When {school.name}'s instructors publish a course, it'll be here. Check back soon.
      </EmptyState>
    );

  return (
    <div className={styles.catalog}>
      {enrolled.length > 0 && (
        <Section title="Continue learning" count={enrolled.length} shelf>
          {enrolled.map((course, i) => (
            <li key={course.id} className={styles.item}>
              <CourseCard course={course} schoolSlug={school.slug} resume={progress.courses[course.id] ?? null} index={i} priority={i < 2} />
            </li>
          ))}
        </Section>
      )}

      {unpublished.length > 0 && (
        <Section
          title={isManager(school.role) ? 'Drafts and archived' : 'Your drafts'}
          note="Only you and the school's admins can see these until they're published."
          count={unpublished.length}
        >
          {unpublished.map((course, i) => (
            <li key={course.id} className={styles.item}>
              <CourseCard course={course} schoolSlug={school.slug} index={i} />
            </li>
          ))}
        </Section>
      )}

      {published.length > 0 ? (
        <Section title="All courses" count={published.length}>
          {published.map((course, i) => (
            <li key={course.id} className={styles.item}>
              <CourseCard course={course} schoolSlug={school.slug} index={i} priority={enrolled.length === 0 && i < 3} />
            </li>
          ))}
        </Section>
      ) : (
        <p className={styles.nothing}>Nothing is published yet. Students see a course once it's published.</p>
      )}
    </div>
  );
}
