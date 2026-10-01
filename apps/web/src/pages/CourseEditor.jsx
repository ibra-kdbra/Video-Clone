import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { m } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { courseSlug as courseSlugSchema } from '@grand/contracts';

import Badge from '../components/Badge.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Button from '../components/Button.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import CourseDetailsForm from '../components/CourseDetailsForm.jsx';
import CourseStatusControl from '../components/CourseStatusControl.jsx';
import EnrollmentsPanel from '../components/EnrollmentsPanel.jsx';
import Icon from '../components/Icon.jsx';
import LessonEditor from '../components/LessonEditor.jsx';
import OutlineEditor from '../components/OutlineEditor.jsx';
import RequireAuth from '../components/RequireAuth.jsx';
import SchoolGate from '../components/SchoolGate.jsx';
import { Block } from '../components/Skeleton.jsx';
import { ErrorState } from '../components/States.jsx';
import StorageMeter from '../components/StorageMeter.jsx';
import { coursePath, deleteCourse, getCourse, getStorage, keys, lessonsOf, patchLesson } from '../lib/courses.js';
import { formatRuntime, joinMeta, plural } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { toast } from '../lib/toast.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useSchoolLive } from '../lib/useSchoolLive.js';
import NotFound from './NotFound.jsx';
import styles from './CourseEditor.module.scss';

// Insights (and their charts) are their own chunk, loaded when the tab is opened.
const CourseInsights = lazy(() => import('../components/CourseInsights.jsx'));

const TABS = [
  { key: 'outline', label: 'Outline', icon: 'list' },
  { key: 'details', label: 'Details', icon: 'edit' },
  { key: 'students', label: 'Students', icon: 'users' },
  { key: 'insights', label: 'Insights', icon: 'chart' },
];

const STATUS = {
  draft: { label: 'Draft', tone: 'warning', note: "Only you and the school's admins can see it." },
  published: { label: 'Published', tone: 'success', note: 'Members of the school can find it and enroll.' },
  archived: { label: 'Archived', tone: 'neutral', note: 'Hidden from the catalog; students can no longer open it.' },
};

function EditorSkeleton() {
  return (
    <div className={`page ${styles.page}`} aria-busy="true">
      <div className={styles.header}>
        <Block width="12rem" height="0.9rem" />
        <Block width="min(26rem, 80%)" height="2.4rem" />
        <Block width="16rem" height="1rem" />
      </div>
      <Block width="100%" height="18rem" radius="var(--radius-lg)" />
    </div>
  );
}

/**
 * The course editor (/s/:slug/c/:course/edit), for the course's author and the school's admins:
 * its status (publish, unpublish, archive), the outline builder with each lesson's editor in a
 * drawer, the details (title, address, summary, description), who's enrolled and how far each
 * has got, and insights into how the course is going. Video storage is shown beside the outline.
 * Transcoding progress for the course's uploads arrives live.
 */
function EditorView({ school, courseSlug }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Opened from here (not by following a link to it): closing goes back, so Back doesn't reopen it.
  const openedHere = useRef(false);
  // After a new address or a deletion, the old address's cache goes once this page has closed
  // (removing it while still shown here would only fetch it again, and find nothing).
  const leaving = useRef(false);
  const slug = school.slug;
  const key = keys.course(slug, courseSlug);
  useEffect(
    () => () => {
      if (leaving.current) queryClient.removeQueries({ queryKey: keys.course(slug, courseSlug), exact: true });
    },
    [queryClient, slug, courseSlug],
  );

  const course = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getCourse(slug, courseSlug, signal),
    staleTime: 30_000,
    retry: (failures, error) => failures < 1 && (error?.status === 0 || error?.status >= 500),
  });
  const storage = useQuery({
    queryKey: keys.storage(slug),
    queryFn: ({ signal }) => getStorage(slug, signal),
    staleTime: 30_000,
    enabled: Boolean(course.data?.canEdit),
  });
  const c = course.data;
  useDocumentTitle(c ? `Edit ${c.title}` : 'Course editor');

  // Uploads in this course move on live: processing progress, then ready (or failed).
  useSchoolLive({
    slug,
    schoolId: school.id,
    enabled: Boolean(c?.canEdit),
    onMedia: (update) => {
      const current = queryClient.getQueryData(key);
      const lesson = lessonsOf(current).find((item) => item.video?.provider === 'upload' && item.video.assetId === update.assetId);
      if (!lesson) return;
      queryClient.setQueryData(key, (data) =>
        patchLesson(data, lesson.id, (item) => ({
          video: { ...item.video, status: update.status, progress: update.progress, error: update.error },
          durationSeconds: update.durationSeconds ?? item.durationSeconds,
        })),
      );
      if (update.status === 'ready' || update.status === 'failed') {
        queryClient.invalidateQueries({ queryKey: key });
        queryClient.invalidateQueries({ queryKey: keys.lesson(slug, courseSlug, lesson.id) });
        queryClient.invalidateQueries({ queryKey: keys.playback(slug, courseSlug, lesson.id) });
        queryClient.invalidateQueries({ queryKey: keys.storage(slug) });
        queryClient.invalidateQueries({ queryKey: keys.courses(slug) });
        toast(update.status === 'ready' ? `"${lesson.title}" is ready to watch` : `"${lesson.title}": the video couldn't be prepared`, {
          tone: update.status === 'ready' ? 'success' : 'error',
        });
      }
    },
    onResync: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  if (course.isPending) return <EditorSkeleton />;
  if (course.isError) {
    if (course.error.status === 404) return <NotFound title="Course not found">There's no course at this address in {school.name}.</NotFound>;
    return (
      <div className="page">
        <ErrorState titleAs="h1" title="Couldn't load this course" error={course.error} onRetry={() => course.refetch()} />
      </div>
    );
  }
  // Only its author and the school's admins edit a course; everyone else gets its page.
  if (!c.canEdit) return <Navigate to={coursePath(slug, courseSlug)} replace />;

  const tab = TABS.find((item) => item.key === params.get('tab')) ?? TABS[0];
  const lessonId = params.get('lesson');
  const status = STATUS[c.status];
  const lessons = lessonsOf(c);
  const base = `/s/${slug}/c/${c.slug}/edit`;

  const openLesson = (id) => {
    openedHere.current = true;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('lesson', id);
      return next;
    });
  };
  const closeLesson = () => {
    if (openedHere.current) {
      openedHere.current = false;
      navigate(-1);
      return;
    }
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('lesson');
        return next;
      },
      { replace: true },
    );
  };

  const forget = () => {
    leaving.current = true;
  };

  const saved = (updated) => {
    queryClient.setQueryData(keys.course(slug, updated.slug), updated);
    queryClient.invalidateQueries({ queryKey: keys.courses(slug) });
    if (updated.slug !== courseSlug) {
      navigate(`/s/${slug}/c/${updated.slug}/edit${tab.key === 'outline' ? '' : `?tab=${tab.key}`}`, { replace: true });
      forget();
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteCourse(slug, courseSlug);
      queryClient.invalidateQueries({ queryKey: keys.courses(slug) });
      queryClient.invalidateQueries({ queryKey: keys.storage(slug) });
      toast(`${c.title} was deleted`);
      navigate(`/s/${slug}`, { replace: true });
      forget();
    } catch (error) {
      setDeleting(false);
      setConfirmDelete(false);
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  return (
    <div className={`page ${styles.page}`}>
      <Breadcrumbs items={[{ label: school.name, to: `/s/${slug}` }, { label: c.title, to: coursePath(slug, c.slug) }, { label: 'Edit' }]} />

      <header className={styles.header}>
        <div className={styles.titles}>
          <p className={styles.eyebrow}>
            <Icon name="edit" size={16} />
            Course editor
          </p>
          <h1 className={styles.title}>{c.title}</h1>
          <p className={styles.meta}>
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>{status.note}</span>
          </p>
          <p className={`${styles.facts} tabular`}>
            {joinMeta(
              plural(c.modules.length, 'module'),
              plural(lessons.length, 'lesson'),
              formatRuntime(c.durationSeconds),
              plural(c.enrollmentCount, 'student'),
            )}
          </p>
        </div>
        <div className={styles.actions}>
          <CourseStatusControl school={school} course={c} onChange={saved} />
          <Button variant="secondary" icon="eye" to={coursePath(slug, c.slug)}>
            View course
          </Button>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Course editor sections">
        {TABS.map((item) => {
          const current = item.key === tab.key;
          return (
            <Link
              key={item.key}
              to={item.key === 'outline' ? base : `${base}?tab=${item.key}`}
              className={styles.tab}
              aria-current={current ? 'page' : undefined}
            >
              {current && <m.span layoutId="editor-tab" className={styles.tabPill} aria-hidden="true" />}
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {tab.key === 'outline' && (
        <div className={styles.split}>
          <OutlineEditor course={c} schoolSlug={slug} onOpenLesson={openLesson} />
          <aside className={styles.aside} aria-label="About this course's videos">
            <section className={styles.card} aria-labelledby="storage-title">
              <h2 id="storage-title" className={styles.cardTitle}>
                Video storage
              </h2>
              {storage.data ? (
                <StorageMeter usage={storage.data} />
              ) : storage.isError ? (
                <p className={styles.muted}>{errorMessage(storage.error)}</p>
              ) : (
                <Block height="5rem" />
              )}
            </section>
            <section className={styles.card} aria-labelledby="tips-title">
              <h2 id="tips-title" className={styles.cardTitle}>
                Good to know
              </h2>
              <ul className={styles.tips}>
                <li>Students see a lesson once both it and the course are published.</li>
                <li>Free previews are open to every member, enrolled or not.</li>
                <li>Uploads are prepared for every screen size, with a poster and seek previews. You can leave while they process.</li>
              </ul>
            </section>
          </aside>
        </div>
      )}

      {tab.key === 'details' && (
        <div className={styles.split}>
          <section className={styles.panel} aria-labelledby="details-title">
            <h2 id="details-title" className={styles.sectionTitle}>
              Details
            </h2>
            <CourseDetailsForm key={c.slug} school={school} course={c} onSaved={saved} />
          </section>
          <aside className={styles.aside}>
            <section className={`${styles.card} ${styles.danger}`} aria-labelledby="delete-title">
              <h2 id="delete-title" className={styles.cardTitle}>
                Delete this course
              </h2>
              <p className={styles.muted}>Its modules, lessons, videos and enrollments are deleted for good.</p>
              <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
                Delete course
              </Button>
            </section>
          </aside>
        </div>
      )}

      {tab.key === 'students' && (
        <section className={styles.panel} aria-labelledby="students-title">
          <h2 id="students-title" className={styles.sectionTitle}>
            Students <span className={`${styles.count} tabular`}>{c.enrollmentCount}</span>
          </h2>
          <EnrollmentsPanel school={school} course={c} />
        </section>
      )}

      {tab.key === 'insights' && (
        <section className={styles.panel} aria-labelledby="insights-title">
          <h2 id="insights-title" className={styles.sectionTitle}>
            Insights
          </h2>
          <Suspense fallback={<Block height="20rem" radius="var(--radius-lg)" />}>
            <CourseInsights school={school} course={c} />
          </Suspense>
        </section>
      )}

      {lessonId && <LessonEditor key={lessonId} school={school} course={c} lessonId={lessonId} onClose={closeLesson} />}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${c.title}?`}
        confirmLabel="Delete course"
        busy={deleting}
        confirmText={c.title}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      >
        <p>
          All of its {plural(lessons.length, 'lesson')} and their videos are deleted, and {plural(c.enrollmentCount, 'student')} lose access. This can't be
          undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}

export default function CourseEditor() {
  const { slug = '', courseSlug = '' } = useParams();
  const parsed = courseSlugSchema.safeParse(courseSlug);
  if (!parsed.success) return <NotFound title="Course not found">This address doesn't point to a course.</NotFound>;
  if (parsed.data !== courseSlug) return <Navigate to={`/s/${slug}/c/${parsed.data}/edit`} replace />;
  return (
    <RequireAuth>
      <SchoolGate slug={slug} fallback={<EditorSkeleton />}>
        {(school) => <EditorView key={`${slug}/${courseSlug}`} school={school} courseSlug={courseSlug} />}
      </SchoolGate>
    </RequireAuth>
  );
}
