import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';
import { courseSlug as courseSlugSchema } from '@grand/contracts';

import Badge from '../components/Badge.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Button from '../components/Button.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import CourseCover from '../components/CourseCover.jsx';
import CourseOutline from '../components/CourseOutline.jsx';
import Icon from '../components/Icon.jsx';
import Markdown from '../components/Markdown.jsx';
import OverflowMenu from '../components/OverflowMenu.jsx';
import RequireAuth from '../components/RequireAuth.jsx';
import SchoolGate from '../components/SchoolGate.jsx';
import { Block } from '../components/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/States.jsx';
import { editorPath, enroll, firstOpenLesson, firstPreview, getCourse, keys, leaveCourse, lessonPath, lessonsOf } from '../lib/courses.js';
import { formatDate, formatRuntime, joinMeta, plural } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { useProgress } from '../lib/progress.js';
import { toast } from '../lib/toast.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import NotFound from './NotFound.jsx';
import styles from './Course.module.scss';

const STATUS_NOTES = {
  draft: { label: 'Draft', tone: 'warning', note: "Only you and the school's admins can see this course until it's published." },
  archived: { label: 'Archived', tone: 'neutral', note: "Archived: students can't see it or enroll." },
};

/** Every lesson open (or closed) to this person, after enrolling or leaving, until the server confirms. */
const withEnrollment = (course, enrolled) =>
  course && {
    ...course,
    enrolled,
    enrollmentCount: Math.max(0, course.enrollmentCount + (enrolled ? 1 : -1)),
    modules: course.modules.map((module) => ({ ...module, lessons: module.lessons.map((lesson) => ({ ...lesson, locked: !enrolled && !lesson.isPreview })) })),
  };

function CourseSkeleton() {
  return (
    <div className={styles.course} aria-busy="true">
      <div className={`${styles.hero} ${styles.heroLoading} theme-dark`}>
        <div className={styles.heroInner}>
          <div className={styles.heroText}>
            <Block width="10rem" height="0.9rem" />
            <Block width="min(30rem, 80%)" height="3rem" />
            <Block width="min(24rem, 70%)" height="1rem" />
            <Block width="12rem" height="3rem" radius="var(--radius-md)" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A course's page (/s/:slug/c/:course): a billboard-like hero with its cover, what it is and who
 * made it, and the main action for this person: Enroll, then Start or Continue where they left
 * off (editors: Edit course). Below, the outline of modules and lessons, and the description.
 */
function CourseView({ school, courseSlug }) {
  const queryClient = useQueryClient();
  const progress = useProgress();
  const slug = school.slug;
  const key = keys.course(slug, courseSlug);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const primary = useRef(null);
  const focusPrimary = useRef(false);

  const course = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getCourse(slug, courseSlug, signal),
    staleTime: 30_000,
    retry: (failures, error) => failures < 1 && (error?.status === 0 || error?.status >= 500),
  });
  const c = course.data;
  useDocumentTitle(c ? `${c.title} · ${school.name}` : course.isError ? 'Course not found' : 'Course');

  const settle = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: keys.courses(slug) });
  };

  const join = useMutation({
    mutationFn: () => enroll(slug, courseSlug),
    onSuccess: () => {
      queryClient.setQueryData(key, (current) => withEnrollment(current, true));
      focusPrimary.current = true;
      settle();
      toast(`You're enrolled in ${c.title}`);
    },
    onError: (error) => toast(errorMessage(error), { tone: 'error' }),
  });

  const leave = useMutation({
    mutationFn: () => leaveCourse(slug, courseSlug),
    onSuccess: () => {
      queryClient.setQueryData(key, (current) => withEnrollment(current, false));
      setConfirmLeave(false);
      settle();
      toast(`You left ${c.title}`);
    },
    onError: (error) => {
      setConfirmLeave(false);
      toast(errorMessage(error), { tone: 'error' });
    },
  });

  // Enrolling swaps the Enroll button for Start: keyboard focus follows it.
  useEffect(() => {
    if (!focusPrimary.current || !c?.enrolled) return;
    focusPrimary.current = false;
    primary.current?.focus();
  }, [c?.enrolled]);

  if (course.isPending) return <CourseSkeleton />;
  if (course.isError) {
    if (course.error.status === 404)
      return (
        <NotFound title="Course not found">
          This course doesn't exist, or isn't published yet. <Link to={`/s/${slug}`}>See {school.name}'s courses</Link>.
        </NotFound>
      );
    return (
      <div className="page">
        <ErrorState titleAs="h1" title="Couldn't load this course" error={course.error} onRetry={() => course.refetch()} />
      </div>
    );
  }

  const lessons = lessonsOf(c);
  const last = progress.courses[c.id];
  const resume = last && lessons.find((lesson) => lesson.id === last.lessonId && !lesson.locked);
  const start = firstOpenLesson(c);
  const preview = firstPreview(c);
  const canWatch = c.enrolled || c.canEdit;
  const status = STATUS_NOTES[c.status];
  const runtime = formatRuntime(c.durationSeconds);
  const facts = joinMeta(c.createdBy && `By ${c.createdBy.name}`, plural(c.lessonCount, 'lesson'), runtime);

  const playTarget = resume ?? start;
  const play = canWatch && playTarget && (
    <Link ref={primary} to={lessonPath(slug, c.slug, playTarget.id)} className={styles.play}>
      <Icon name="play" size={20} />
      <span className={styles.playLabel}>
        {resume ? 'Continue' : 'Start course'}
        {resume && <span className={styles.playSub}>{resume.title}</span>}
      </span>
    </Link>
  );

  return (
    <div className={styles.course}>
      <section className={`${styles.hero} theme-dark`} aria-labelledby="course-title">
        <div className={styles.backdrop}>
          <CourseCover course={c} variant="backdrop" priority />
        </div>
        <div className={styles.heroInner}>
          <Breadcrumbs items={[{ label: school.name, to: `/s/${slug}` }, { label: c.title }]} />
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>
              <Icon name="layers" size={16} />
              <span>Course</span>
              {status && c.canEdit && (
                <Badge tone={status.tone} glass>
                  {status.label}
                </Badge>
              )}
              {c.enrolled && (
                <Badge tone="success" icon="check" glass>
                  Enrolled
                </Badge>
              )}
            </p>
            <h1 id="course-title" className={styles.title}>
              {c.title}
            </h1>
            {c.summary && <p className={styles.summary}>{c.summary}</p>}
            <p className={`${styles.facts} tabular`}>
              {facts}
              {c.enrollmentCount > 0 && <span className={styles.students}>{plural(c.enrollmentCount, 'student')}</span>}
            </p>

            <div className={styles.actions}>
              {play}
              {!canWatch && c.status === 'published' && (
                <Button ref={primary} variant="primary" icon="plus" busy={join.isPending} onClick={() => join.mutate()} className={styles.enroll}>
                  Enroll
                </Button>
              )}
              {!canWatch && preview && (
                <Link to={lessonPath(slug, c.slug, preview.id)} className={styles.glass}>
                  <Icon name="eye" size={20} />
                  Watch free preview
                </Link>
              )}
              {c.canEdit && (
                <Link ref={play ? undefined : primary} to={editorPath(slug, c.slug)} className={styles.glass}>
                  <Icon name="edit" size={20} />
                  Edit course
                </Link>
              )}
              {c.enrolled && !c.canEdit && (
                <OverflowMenu
                  label="More actions for this course"
                  items={[{ label: 'Leave course', icon: 'logout', tone: 'danger', onSelect: () => setConfirmLeave(true) }]}
                />
              )}
            </div>
            {status && c.canEdit && <p className={styles.statusNote}>{status.note}</p>}
          </div>
        </div>
      </section>

      <div className={`page ${styles.body}`}>
        <section className={styles.lessons} aria-labelledby="lessons-title">
          <header className={styles.sectionHead}>
            <h2 id="lessons-title" className={styles.sectionTitle}>
              Lessons
            </h2>
            <p className={`${styles.sectionMeta} tabular`}>{joinMeta(plural(c.modules.length, 'module'), plural(lessons.length, 'lesson'), runtime)}</p>
          </header>
          {!canWatch && lessons.length > 0 && (
            <p className={styles.hint}>
              <Icon name="lock" size={16} />
              <span>Enroll to unlock every lesson.{preview ? ' Lessons marked Free preview are open to everyone in the school.' : ''}</span>
            </p>
          )}
          {lessons.length === 0 && !c.canEdit ? (
            <EmptyState icon="film" title="No lessons yet" titleAs="h3">
              The first lessons of this course are on their way. Check back soon.
            </EmptyState>
          ) : (
            <CourseOutline course={c} schoolSlug={slug} />
          )}
        </section>

        <aside className={styles.about} aria-labelledby="about-title">
          <h2 id="about-title" className={styles.sectionTitle}>
            About this course
          </h2>
          {c.description.trim() ? <Markdown>{c.description}</Markdown> : <p className={styles.muted}>{c.summary || 'No description yet.'}</p>}
          <dl className={styles.details}>
            {c.createdBy && (
              <div>
                <dt>Instructor</dt>
                <dd>{c.createdBy.name}</dd>
              </div>
            )}
            <div>
              <dt>Length</dt>
              <dd className="tabular">{joinMeta(plural(lessons.length, 'lesson'), runtime) || 'No lessons yet'}</dd>
            </div>
            <div>
              <dt>Students</dt>
              <dd className="tabular">{c.enrollmentCount.toLocaleString()}</dd>
            </div>
            {c.publishedAt && (
              <div>
                <dt>Published</dt>
                <dd>{formatDate(c.publishedAt)}</dd>
              </div>
            )}
          </dl>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        title={`Leave ${c.title}?`}
        confirmLabel="Leave course"
        busy={leave.isPending}
        onConfirm={() => leave.mutate()}
        onClose={() => setConfirmLeave(false)}
        returnFocus={primary}
      >
        <p>Its lessons will be locked again, except free previews. You can enroll again at any time.</p>
      </ConfirmDialog>
    </div>
  );
}

export default function Course() {
  const { slug = '', courseSlug = '' } = useParams();
  const parsed = courseSlugSchema.safeParse(courseSlug);
  if (!parsed.success) return <NotFound title="Course not found">This address doesn't point to a course.</NotFound>;
  // Addresses are lower case; /c/My-Course leads to /c/my-course.
  if (parsed.data !== courseSlug) return <Navigate to={`/s/${slug}/c/${parsed.data}`} replace />;
  return (
    <RequireAuth>
      <SchoolGate slug={slug} fallback={<CourseSkeleton />}>
        {(school) => <CourseView key={`${slug}/${courseSlug}`} school={school} courseSlug={courseSlug} />}
      </SchoolGate>
    </RequireAuth>
  );
}
