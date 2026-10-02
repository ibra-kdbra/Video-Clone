import { lazy, Suspense, useId } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { continueLesson, coursePath, editorPath, firstOpenLesson, getCourse, getCourses, keys, lessonPath } from '../lib/courses.js';
import { formatRuntime, joinMeta, plural } from '../lib/format.js';
import { coursesYouTeach, continueLearning, dashboardLine, greeting, isStaff } from '../lib/home.js';
import { isManager } from '../lib/roles.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useSession } from '../lib/useSession.js';
import Badge from './Badge.jsx';
import Button from './Button.jsx';
import CourseCover from './CourseCover.jsx';
import Icon from './Icon.jsx';
import ProgressBar from './ProgressBar.jsx';
import SchoolRow from './SchoolRow.jsx';
import { Block } from './Skeleton.jsx';
import { EmptyState } from './States.jsx';
import styles from './Dashboard.module.scss';

// Upcoming live classes: their own small chunk, with the schedule's helpers.
const UpcomingLive = lazy(() => import('./UpcomingLive.jsx'));

const STATUS = { draft: { label: 'Draft', tone: 'warning', icon: 'edit' }, archived: { label: 'Archived', tone: 'neutral', icon: 'archive' } };

/** A titled part of the dashboard, with an optional link on the right. */
function Section({ title, action, children }) {
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={id}>
      <header className={styles.sectionHead}>
        <h2 id={id} className={styles.sectionTitle}>
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/** One course to carry on with: how far along, and the lesson to open next. */
function ContinueCard({ school, course, detail, index }) {
  const progress = course.progress;
  const done = progress && progress.totalLessons > 0 && progress.completedLessons >= progress.totalLessons;
  const next = detail ? (continueLesson(detail) ?? firstOpenLesson(detail)) : null;
  const target = next?.id ?? progress?.lastLessonId;
  const started = Boolean(progress?.lastLessonId);
  const label = done ? 'Review' : started ? 'Continue' : 'Start';
  return (
    <article className={styles.continue} style={{ '--i': index }}>
      <div className={styles.cover}>
        <CourseCover course={course} variant="thumb" priority={index < 2} />
        {progress && progress.percent > 0 && <ProgressBar value={progress.percent} tone={done ? 'success' : 'accent'} className={styles.coverBar} />}
      </div>
      <div className={styles.continueBody}>
        <p className={styles.school}>{school.name}</p>
        <h3 className={styles.courseTitle}>
          <Link to={coursePath(school.slug, course.slug)}>{course.title}</Link>
        </h3>
        <p className={`${styles.progressLine} tabular`}>
          {done ? (
            <>
              <Icon name="checkCircle" size={14} />
              Completed
            </>
          ) : (
            `${progress?.completedLessons ?? 0} of ${plural(progress?.totalLessons ?? course.lessonCount, 'lesson')} done · ${progress?.percent ?? 0}%`
          )}
        </p>
        <div className={styles.continueActions}>
          <Button
            size="sm"
            variant={done ? 'secondary' : 'primary'}
            icon="play"
            to={target ? lessonPath(school.slug, course.slug, target) : coursePath(school.slug, course.slug)}
            aria-label={`${label}: ${course.title}`}
          >
            {label}
          </Button>
          {next && !done && (
            <span className={styles.nextLesson}>
              <span className="visually-hidden">Next lesson: </span>
              {next.title}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/** A course this person teaches: its state, and the way to edit it and see how it's going. */
function TeachRow({ school, course, detail }) {
  const status = STATUS[course.status];
  const editor = editorPath(school.slug, course.slug);
  return (
    <li className={styles.teach}>
      <div className={styles.teachCover}>
        <CourseCover course={course} variant="thumb" />
      </div>
      <div className={styles.teachText}>
        <h3 className={styles.teachTitle}>
          <Link to={coursePath(school.slug, course.slug)}>{course.title}</Link>
        </h3>
        <p className={`${styles.teachMeta} tabular`}>
          {status && (
            <Badge tone={status.tone} icon={status.icon}>
              {status.label}
            </Badge>
          )}
          <span>{joinMeta(plural(course.lessonCount, 'lesson'), formatRuntime(course.durationSeconds), detail && plural(detail.enrollmentCount, 'student'))}</span>
        </p>
      </div>
      <div className={styles.teachActions}>
        <Button size="sm" variant="ghost" icon="edit" to={editor} aria-label={`Edit ${course.title}`}>
          Edit
        </Button>
        <Button size="sm" variant="secondary" icon="chart" to={`${editor}?tab=insights`} aria-label={`Insights for ${course.title}`}>
          Insights
        </Button>
      </div>
    </li>
  );
}

function DashboardSkeleton() {
  return (
    <div className={`page ${styles.dashboard}`} aria-busy="true">
      <Block width="min(22rem, 80%)" height="2.4rem" />
      <Block width="min(16rem, 60%)" height="1rem" />
      <div className={styles.grid} aria-hidden="true">
        {Array.from({ length: 2 }, (_, i) => (
          <Block key={i} height="9rem" radius="var(--radius-lg)" />
        ))}
      </div>
    </div>
  );
}

/**
 * The home page for someone signed in: a greeting, the live classes coming up, the courses to
 * carry on with (across every school, with how far along and a button to the right lesson), for
 * instructors and above the courses they teach (with a way to their insights), and their schools.
 */
export default function Dashboard() {
  const { user, schools, schoolsLoading } = useSession();
  useDocumentTitle(null);

  const catalogQueries = useQueries({
    queries: schools.map((school) => ({
      queryKey: keys.courses(school.slug),
      queryFn: ({ signal }) => getCourses(school.slug, signal),
      staleTime: 30_000,
    })),
  });
  const catalogs = schools.map((school, i) => ({ school, courses: catalogQueries[i]?.data }));
  const learning = continueLearning(catalogs);

  // The full courses: for the lesson to carry on with, and (in schools where this person is on the
  // staff) who wrote each. They're the course pages' own cache entries, so those open at once.
  const wanted = [
    ...learning.map(({ school, course }) => [school.slug, course.slug]),
    ...catalogs.filter(({ school }) => isStaff(school.role)).flatMap(({ school, courses }) => (courses ?? []).map((course) => [school.slug, course.slug])),
  ].filter(([slug, courseSlug], index, list) => list.findIndex((item) => item[0] === slug && item[1] === courseSlug) === index);
  const detailQueries = useQueries({
    queries: wanted.map(([slug, courseSlug]) => ({
      queryKey: keys.course(slug, courseSlug),
      queryFn: ({ signal }) => getCourse(slug, courseSlug, signal),
      staleTime: 30_000,
    })),
  });
  const details = new Map(wanted.map(([slug, courseSlug], i) => [`${slug}/${courseSlug}`, detailQueries[i]?.data]));
  const teaching = coursesYouTeach(catalogs, details, user?.id);
  const staffSchools = schools.filter((school) => isStaff(school.role));
  const loadingCatalogs = catalogQueries.some((query) => query.isPending);
  // Staff see the courses they teach first; "Continue learning" only when they're taking one too.
  const showLearning = !staffSchools.length || loadingCatalogs || learning.length > 0;
  const loadingDetails = detailQueries.some((query) => query.isPending);

  if (schoolsLoading || !user) return <DashboardSkeleton />;

  return (
    <div className={`page ${styles.dashboard}`}>
      <header className={styles.head}>
        <h1 className={styles.greeting}>{greeting(user.name)}</h1>
        <p className={styles.line}>{loadingCatalogs ? ' ' : dashboardLine({ learning, teaching: teaching.length })}</p>
      </header>

      {schools.length === 0 ? (
        <EmptyState
          icon="school"
          title="You're not in a school yet"
          titleAs="h2"
          action={
            <div className={styles.emptyActions}>
              <Button variant="primary" icon="plus" to="/schools/new">
                Create a school
              </Button>
              <Button variant="ghost" icon="compass" to="/explore">
                Explore videos
              </Button>
            </div>
          }
        >
          Create one for your own students, or open the invitation link your school emailed you.
        </EmptyState>
      ) : (
        <>
          <Suspense fallback={null}>
            <UpcomingLive schools={schools} showSchool={schools.length > 1} />
          </Suspense>

          {staffSchools.length > 0 && (
            <Section
              title="Courses you teach"
              action={
                <Link to={`/s/${staffSchools[0].slug}`} className={styles.more}>
                  {isManager(staffSchools[0].role) ? `All courses in ${staffSchools[0].name}` : `Open ${staffSchools[0].name}`}
                  <Icon name="chevronRight" size={16} />
                </Link>
              }
            >
              {teaching.length ? (
                <ul className={styles.teachList}>
                  {teaching.map(({ school, course, detail }) => (
                    <TeachRow key={course.id} school={school} course={course} detail={detail} />
                  ))}
                </ul>
              ) : loadingCatalogs || loadingDetails ? (
                <Block height="5rem" radius="var(--radius-lg)" />
              ) : (
                <p className={styles.nothing}>
                  You haven't written a course yet. Start one from <Link to={`/s/${staffSchools[0].slug}`}>{staffSchools[0].name}</Link>: give it a title, then add lessons, quizzes
                  and assignments.
                </p>
              )}
            </Section>
          )}

          {showLearning && (
            <Section title="Continue learning">
              {loadingCatalogs ? (
                <div className={styles.grid} aria-hidden="true">
                  <Block height="9rem" radius="var(--radius-lg)" />
                  <Block height="9rem" radius="var(--radius-lg)" />
                </div>
              ) : learning.length ? (
                <div className={styles.grid}>
                  {learning.map(({ school, course }, i) => (
                    <ContinueCard key={course.id} school={school} course={course} detail={details.get(`${school.slug}/${course.slug}`)} index={i} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="layers"
                  title="Nothing in progress yet"
                  titleAs="h3"
                  action={
                    <Button variant="primary" icon="layers" to={`/s/${schools[0].slug}`}>
                      Browse {schools[0].name}'s courses
                    </Button>
                  }
                >
                  Enroll in a course and it'll be here, ready to pick up where you left off.
                </EmptyState>
              )}
            </Section>
          )}

          <SchoolRow schools={schools} loading={false} />
        </>
      )}
    </div>
  );
}
