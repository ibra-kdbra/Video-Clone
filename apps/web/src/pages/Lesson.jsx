import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { courseSlug as courseSlugSchema, uuid } from '@grand/contracts';

import Badge from '../components/Badge.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Button from '../components/Button.jsx';
import CourseOutline from '../components/CourseOutline.jsx';
import Icon from '../components/Icon.jsx';
import LessonStage from '../components/LessonStage.jsx';
import Markdown from '../components/Markdown.jsx';
import RequireAuth from '../components/RequireAuth.jsx';
import SchoolGate from '../components/SchoolGate.jsx';
import { Block } from '../components/Skeleton.jsx';
import { ErrorState } from '../components/States.jsx';
import { coursePath, editorPath, enroll, getCourse, getLesson, getPlayback, keys, kindOf, lessonPath, lessonsOf, patchLesson } from '../lib/courses.js';
import { formatDate, formatDuration, joinMeta } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { applyProgress, completeLesson } from '../lib/learning.js';
import { lessonNumbers, locateLesson } from '../lib/outline.js';
import { toast } from '../lib/toast.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useMediaQuery } from '../lib/useMediaQuery.js';
import { useSchoolLive } from '../lib/useSchoolLive.js';
import { useWatchProgress } from '../lib/useWatchProgress.js';
import { resumeAt } from '../lib/watchTracker.js';
import NotFound from './NotFound.jsx';
import styles from './Lesson.module.scss';

// Quizzes and assignments have their own chunks, loaded only when one is opened.
const QuizPanel = lazy(() => import('../components/QuizPanel.jsx'));
const AssignmentPanel = lazy(() => import('../components/AssignmentPanel.jsx'));

// Wide screens keep the outline beside the player; narrower ones fold it under the title.
const SIDE_BY_SIDE = '(min-width: 1200px)';

const noRetryOn4xx = (failures, error) => failures < 1 && (error?.status === 0 || error?.status >= 500);

/** Playback links last a few hours: cached until shortly before they expire. */
const playbackStaleTime = (query) => {
  const expiresAt = Date.parse(query.state.data?.expiresAt ?? '');
  return Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now() - 5 * 60_000) : 30_000;
};

/**
 * The course's outline beside the lesson (wide screens), or in a section that opens and closes.
 * `sticky` keeps the side panel in view as a quiz or an assignment scrolls by.
 */
function OutlinePanel({ course, schoolSlug, lessonId, side, sticky = false }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const lessons = lessonsOf(course);
  const index = lessons.findIndex((lesson) => lesson.id === lessonId);
  const position = index === -1 ? '' : `Lesson ${index + 1} of ${lessons.length}`;
  const done = course.progress ? `${course.progress.completedLessons} of ${course.progress.totalLessons} done` : '';

  if (side)
    return (
      <aside className={`${styles.side} ${sticky ? styles.sticky : ''}`} aria-labelledby={`${regionId}-title`}>
        {/* Out of the flow, so the player alone sets the stage's height and the list scrolls within it. */}
        <div className={styles.sidePanel}>
          <header className={styles.sideHead}>
            <h2 id={`${regionId}-title`} className={styles.sideTitle}>
              <Link to={coursePath(schoolSlug, course.slug)}>{course.title}</Link>
            </h2>
            <p className={`${styles.sideMeta} tabular`}>{joinMeta(position, done)}</p>
          </header>
          <div className={styles.sideScroll} data-outline-scroll>
            <CourseOutline course={course} schoolSlug={schoolSlug} currentId={lessonId} compact />
          </div>
        </div>
      </aside>
    );

  return (
    <section className={styles.fold} aria-labelledby={`${regionId}-title`}>
      <h2 id={`${regionId}-title`} className={styles.foldTitle}>
        <button type="button" className={styles.foldButton} aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((value) => !value)}>
          <Icon name="list" size={20} />
          <span className={styles.foldText}>
            <span>Course outline</span>
            <span className={`${styles.foldMeta} tabular`}>{joinMeta(position, done)}</span>
          </span>
          <Icon name="chevronDown" size={20} className={styles.foldChevron} />
        </button>
      </h2>
      <div id={regionId} className={styles.foldBody} hidden={!open}>
        <CourseOutline course={course} schoolSlug={schoolSlug} currentId={lessonId} compact />
      </div>
    </section>
  );
}

/**
 * For enrolled students, on lessons without an uploaded video (reading, or a video on another
 * platform, whose player can't say what was watched): "Mark as complete", then a quiet
 * "Completed", which takes focus so it's announced.
 */
function MarkComplete({ lesson, busy, onComplete }) {
  const done = useRef(null);
  const pressed = useRef(false);
  const completed = lesson.progressDetail.completed;
  useEffect(() => {
    if (completed && pressed.current) done.current?.focus();
  }, [completed]);

  if (completed)
    return (
      <p ref={done} tabIndex={-1} className={styles.completed}>
        <Icon name="checkCircle" size={18} />
        Completed
        {lesson.progressDetail.completedAt && <span className={styles.completedOn}>{formatDate(lesson.progressDetail.completedAt)}</span>}
      </p>
    );
  return (
    <Button
      variant="secondary"
      size="sm"
      icon="check"
      busy={busy}
      onClick={() => {
        pressed.current = true;
        onComplete();
      }}
    >
      Mark as complete
    </Button>
  );
}

/** Previous and next, as two cards. */
function Steps({ lesson, slug, courseSlug }) {
  return (
    <nav className={styles.steps} aria-label="Previous and next lessons">
      {lesson.previous ? (
        <Link to={lessonPath(slug, courseSlug, lesson.previous.id)} className={styles.step} rel="prev">
          <Icon name="chevronLeft" size={20} />
          <span className={styles.stepText}>
            <span className={styles.stepLabel}>Previous</span>
            <span className={styles.stepTitle}>{lesson.previous.title}</span>
          </span>
        </Link>
      ) : (
        <span />
      )}
      {lesson.next ? (
        <Link to={lessonPath(slug, courseSlug, lesson.next.id)} className={`${styles.step} ${styles.next}`} rel="next">
          <span className={styles.stepText}>
            <span className={styles.stepLabel}>Next</span>
            <span className={styles.stepTitle}>{lesson.next.title}</span>
          </span>
          <Icon name="chevronRight" size={20} />
        </Link>
      ) : (
        <Link to={coursePath(slug, courseSlug)} className={`${styles.step} ${styles.next}`}>
          <span className={styles.stepText}>
            <span className={styles.stepLabel}>Last lesson</span>
            <span className={styles.stepTitle}>Back to the course</span>
          </span>
          <Icon name="chevronRight" size={20} />
        </Link>
      )}
    </nav>
  );
}

/** A quiz or an assignment that isn't open to this person yet: enroll, right here. */
function LockedWork({ course, kind, onEnroll, enrolling }) {
  return (
    <div className={styles.locked}>
      <span className={styles.lockedIcon}>
        <Icon name="lock" size={24} />
      </span>
      <div className={styles.lockedText}>
        <p className={styles.lockedTitle}>Enroll to open this {kind.label.toLowerCase()}</p>
        <p className={styles.muted}>
          It's part of <strong>{course?.title ?? 'this course'}</strong>. Enrolling opens every lesson, and it's free for members of the school.
        </p>
      </div>
      {course?.status === 'published' && (
        <Button variant="primary" icon="plus" busy={enrolling} onClick={onEnroll}>
          Enroll
        </Button>
      )}
    </div>
  );
}

/**
 * A lesson (/s/:slug/c/:course/l/:lesson). A video lesson is a cinema-style player on a dark
 * stage (with the outline beside it on wide screens), then its title, previous and next, and its
 * notes. A quiz or an assignment is a page of its own: the instructions, then the quiz to take or
 * the work to hand in. Locked lessons offer Enroll in place; videos still being prepared show
 * their progress live and start playing once ready.
 *
 * For enrolled students, the player reports what's watched (it completes at 90%) and resumes
 * where they left off; lessons without an uploaded video have "Mark as complete".
 */
function LessonView({ school, courseSlug, lessonId }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const side = useMediaQuery(SIDE_BY_SIDE);
  const slug = school.slug;
  // Read once: whether "Next lesson" asked to start playing right away.
  const [autoPlay] = useState(() => location.state?.autoplay === true);

  const course = useQuery({
    queryKey: keys.course(slug, courseSlug),
    queryFn: ({ signal }) => getCourse(slug, courseSlug, signal),
    staleTime: 30_000,
    retry: noRetryOn4xx,
  });
  // From the cached outline: a locked lesson isn't even asked for (the answer is known), and the
  // video can start loading before the lesson itself has arrived.
  const summary = lessonsOf(course.data).find((item) => item.id === lessonId);
  const lesson = useQuery({
    queryKey: keys.lesson(slug, courseSlug, lessonId),
    queryFn: ({ signal }) => getLesson(slug, courseSlug, lessonId, signal),
    enabled: !summary?.locked,
    staleTime: 30_000,
    retry: noRetryOn4xx,
  });
  const locked = Boolean(summary?.locked) || lesson.error?.code === 'enrollment_required';
  const shown = lesson.data ?? summary;
  const kindName = shown?.kind ?? null;
  const video = kindName === 'lesson' ? (lesson.data ? lesson.data.video : summary && !summary.locked ? summary.video : null) : null;
  const playback = useQuery({
    queryKey: keys.playback(slug, courseSlug, lessonId),
    queryFn: ({ signal }) => getPlayback(slug, courseSlug, lessonId, signal),
    enabled: Boolean(video) && !locked,
    staleTime: playbackStaleTime,
    retry: noRetryOn4xx,
    // Live updates on a video being prepared go to the school's staff only; everyone else (and
    // anyone whose connection dropped) checks back now and then.
    refetchInterval: (query) => (query.state.data?.kind === 'processing' && query.state.data.status !== 'failed' ? 15_000 : false),
  });

  const c = course.data;
  const title = lesson.data?.title ?? summary?.title;
  useDocumentTitle(title ? `${title} · ${c?.title ?? 'Course'}` : 'Lesson');

  // Where to resume: decided once, when the lesson (with this person's progress) first arrives.
  const [startAt, setStartAt] = useState(null);
  if (startAt === null && lesson.data) {
    const detail = lesson.data.progressDetail;
    setStartAt(detail ? resumeAt(detail.positionSeconds, lesson.data.durationSeconds) : 0);
  }

  // Watch progress, for enrolled students on an uploaded video.
  const tracking = Boolean(lesson.data?.progressDetail) && lesson.data.kind === 'lesson' && lesson.data.video?.provider === 'upload';
  const nextLesson = lesson.data?.next;
  const nextTitle = nextLesson?.title;
  const onReport = useCallback(
    (progress) => {
      const before = queryClient.getQueryData(keys.lesson(slug, courseSlug, lessonId))?.progressDetail;
      applyProgress(queryClient, slug, courseSlug, lessonId, progress);
      if (progress.completed && before && !before.completed) toast(nextTitle ? `Lesson complete. Up next: ${nextTitle}` : 'Lesson complete');
    },
    [queryClient, slug, courseSlug, lessonId, nextTitle],
  );
  const watch = useWatchProgress({ slug, courseSlug, lessonId, enabled: tracking, onReport });

  const markDone = useMutation({
    mutationFn: () => completeLesson(slug, courseSlug, lessonId),
    onSuccess: (progress) => {
      applyProgress(queryClient, slug, courseSlug, lessonId, progress);
      toast('Marked as complete');
    },
    onError: (error) => toast(errorMessage(error), { tone: 'error' }),
  });

  // An uploaded video still being prepared moves on live (for staff); once it's ready, the player
  // takes over.
  const processing = playback.data?.kind === 'processing' && playback.data.status !== 'failed';
  const assetId = video?.provider === 'upload' ? video.assetId : null;
  useSchoolLive({
    slug,
    schoolId: school.id,
    enabled: processing,
    onMedia: (update) => {
      if (update.assetId !== assetId) return;
      if (update.status === 'ready' || update.status === 'failed') {
        queryClient.invalidateQueries({ queryKey: keys.playback(slug, courseSlug, lessonId) });
        queryClient.invalidateQueries({ queryKey: keys.lesson(slug, courseSlug, lessonId) });
        queryClient.invalidateQueries({ queryKey: keys.course(slug, courseSlug) });
        if (update.status === 'ready') toast('The video is ready', { tone: 'info' });
        return;
      }
      queryClient.setQueryData(keys.playback(slug, courseSlug, lessonId), {
        kind: 'processing',
        status: update.status,
        progress: update.progress,
        error: update.error,
      });
      // The outline beside it says how far along it is too (editors see that).
      queryClient.setQueryData(keys.course(slug, courseSlug), (current) =>
        patchLesson(current, lessonId, (item) => ({
          video: item.video && { ...item.video, status: update.status, progress: update.progress, error: update.error },
        })),
      );
    },
    onResync: () => queryClient.invalidateQueries({ queryKey: keys.playback(slug, courseSlug, lessonId) }),
  });

  const join = useMutation({
    mutationFn: () => enroll(slug, courseSlug),
    onSuccess: () => {
      toast(`You're enrolled in ${c?.title ?? 'this course'}`);
      queryClient.invalidateQueries({ queryKey: keys.course(slug, courseSlug) });
      queryClient.invalidateQueries({ queryKey: keys.courses(slug) });
      queryClient.invalidateQueries({ queryKey: keys.lesson(slug, courseSlug, lessonId) });
      queryClient.invalidateQueries({ queryKey: keys.quiz(slug, courseSlug, lessonId) });
      queryClient.invalidateQueries({ queryKey: keys.assignment(slug, courseSlug, lessonId) });
    },
    onError: (error) => toast(errorMessage(error), { tone: 'error' }),
  });

  // A stable function (refetch is), so the player's handlers don't change with every render.
  const refetchPlayback = playback.refetch;
  const refreshPlayback = useCallback(async () => (await refetchPlayback()).data, [refetchPlayback]);
  const nextTo = nextLesson ? lessonPath(slug, courseSlug, nextLesson.id) : null;
  const next = nextLesson ? { title: nextLesson.title, to: nextTo, go: () => navigate(nextTo, { state: { autoplay: true } }) } : null;

  if (course.isError && course.error.status === 404)
    return (
      <NotFound title="Course not found">
        This course doesn't exist, or isn't published yet. <Link to={`/s/${slug}`}>See {school.name}'s courses</Link>.
      </NotFound>
    );
  if (lesson.isError && lesson.error.status === 404)
    return (
      <NotFound title="Lesson not found">
        This lesson isn't in the course, or isn't published yet. <Link to={coursePath(slug, courseSlug)}>Back to the course</Link>.
      </NotFound>
    );

  const numbers = c ? lessonNumbers(c.modules) : new Map();
  const where = c ? locateLesson(c.modules, lessonId) : null;
  const module = where ? c.modules[where.moduleIndex] : null;
  const editHref = editorPath(slug, courseSlug, lessonId);
  const kind = kindOf(shown);
  const detail = lesson.data?.progressDetail ?? null;
  const canMarkDone = Boolean(detail) && lesson.data.kind === 'lesson' && lesson.data.video?.provider !== 'upload';
  const failed = lesson.isError && !locked && lesson.error.status !== 404;

  const crumbs = (
    <Breadcrumbs
      className={styles.crumbs}
      items={[{ label: school.name, to: `/s/${slug}` }, { label: c?.title ?? 'Course', to: coursePath(slug, courseSlug) }, { label: title ?? 'Lesson' }]}
    />
  );

  const header =
    failed && !shown ? (
      <ErrorState titleAs="h1" title="Couldn't load this lesson" error={lesson.error} onRetry={() => lesson.refetch()} />
    ) : (
      <header className={styles.head}>
        <p className={`${styles.eyebrow} tabular`}>
          {joinMeta(module && `Module ${where.moduleIndex + 1} · ${module.title}`, numbers.get(lessonId) && `Lesson ${numbers.get(lessonId)}`)}
        </p>
        {title ? <h1 className={styles.title}>{title}</h1> : <Block width="min(28rem, 80%)" height="2.2rem" />}
        {shown && (
          <div className={styles.meta}>
            {shown.kind !== 'lesson' && (
              <Badge tone="accent" icon={kind.icon}>
                {kind.label}
              </Badge>
            )}
            {shown.kind === 'lesson' && formatDuration(shown.durationSeconds) && (
              <span className={styles.duration}>
                <Icon name="clock" size={16} />
                <span className="tabular">{formatDuration(shown.durationSeconds)}</span>
              </span>
            )}
            {shown.isPreview && <Badge tone="teal">Free preview</Badge>}
            {c?.canEdit && shown.status === 'draft' && <Badge tone="warning">Draft: only editors can see it</Badge>}
            {detail?.completed && !canMarkDone && (
              <Badge tone="success" icon="check">
                Completed
              </Badge>
            )}
            {c?.canEdit && (
              <Link to={editHref} className={styles.edit}>
                <Icon name="edit" size={16} />
                {shown.kind === 'lesson' ? 'Edit lesson' : `Edit ${kind.label.toLowerCase()}`}
              </Link>
            )}
            {canMarkDone && <MarkComplete lesson={lesson.data} busy={markDone.isPending} onComplete={() => markDone.mutate()} />}
          </div>
        )}
      </header>
    );

  // Quizzes and assignments: a page to work on, with the outline beside it on wide screens.
  if (kindName === 'quiz' || kindName === 'assignment') {
    const notes = lesson.data?.notes?.trim();
    const Panel = kindName === 'quiz' ? QuizPanel : AssignmentPanel;
    return (
      <div className={`page ${styles.work} ${side && c ? styles.withSide : ''}`}>
        <div className={styles.workMain}>
          {crumbs}
          {header}
          {locked ? (
            <LockedWork course={c} kind={kind} onEnroll={() => join.mutate()} enrolling={join.isPending} />
          ) : (
            <>
              {notes && (
                <section className={styles.notes} aria-labelledby="notes-title">
                  <h2 id="notes-title" className={styles.notesTitle}>
                    Instructions
                  </h2>
                  <Markdown>{lesson.data.notes}</Markdown>
                </section>
              )}
              {lesson.data && (
                <Suspense fallback={<Block height="14rem" radius="var(--radius-lg)" />}>
                  <Panel school={school} course={c} courseSlug={courseSlug} lesson={lesson.data} editHref={editHref} />
                </Suspense>
              )}
              {lesson.isPending && <Block height="14rem" radius="var(--radius-lg)" />}
            </>
          )}
          {lesson.data && <Steps lesson={lesson.data} slug={slug} courseSlug={courseSlug} />}
          {!side && c && <OutlinePanel course={c} schoolSlug={slug} lessonId={lessonId} />}
        </div>
        {side && c && <OutlinePanel course={c} schoolSlug={slug} lessonId={lessonId} side sticky />}
      </div>
    );
  }

  // Not known yet whether it's a video, a quiz or an assignment: hold the place.
  if (!kindName && !locked && !failed) return <div className={styles.placeholder} aria-busy="true" />;

  const stageState = locked
    ? 'locked'
    : lesson.isPending && !summary
      ? 'loading'
      : lesson.isError
        ? 'error'
        : !video && lesson.data
          ? 'none'
          : playback.isError
            ? 'error'
            : playback.data && startAt !== null
              ? 'ready'
              : 'loading';
  const stageError = lesson.isError ? lesson.error : playback.error;

  return (
    <div className={styles.lesson}>
      <section className={`${styles.theater} theme-dark`} aria-label="Lesson video">
        <div className={`${styles.theaterInner} ${side && c ? styles.withSide : ''}`}>
          <div className={styles.screen}>
            <LessonStage
              state={stageState}
              playback={playback.data}
              lesson={shown ?? { title: 'Lesson' }}
              course={c}
              startAt={startAt ?? 0}
              autoPlay={autoPlay}
              onRefresh={refreshPlayback}
              watch={watch}
              next={next}
              onEnroll={() => join.mutate()}
              enrolling={join.isPending}
              error={stageError}
              onRetry={() => (lesson.isError ? lesson.refetch() : playback.refetch())}
              editHref={editHref}
            />
          </div>
          {side && c && <OutlinePanel course={c} schoolSlug={slug} lessonId={lessonId} side />}
        </div>
      </section>

      <div className={`page ${styles.body}`}>
        {crumbs}
        {header}

        {lesson.data && <Steps lesson={lesson.data} slug={slug} courseSlug={courseSlug} />}

        {!side && c && <OutlinePanel course={c} schoolSlug={slug} lessonId={lessonId} />}

        {(lesson.data?.notes?.trim() || lesson.data?.summary) && (
          <section className={styles.notes} aria-labelledby="notes-title">
            <h2 id="notes-title" className={styles.notesTitle}>
              Notes
            </h2>
            {lesson.data.notes.trim() ? <Markdown>{lesson.data.notes}</Markdown> : <p className={styles.summary}>{lesson.data.summary}</p>}
          </section>
        )}
      </div>
    </div>
  );
}

export default function Lesson() {
  const { slug = '', courseSlug = '', lessonId = '' } = useParams();
  const parsed = courseSlugSchema.safeParse(courseSlug);
  if (!parsed.success || !uuid.safeParse(lessonId).success) return <NotFound title="Lesson not found">This address doesn't point to a lesson.</NotFound>;
  if (parsed.data !== courseSlug) return <Navigate to={lessonPath(slug, parsed.data, lessonId)} replace />;
  return (
    <RequireAuth>
      <SchoolGate slug={slug} fallback={<div className={styles.placeholder} aria-busy="true" />}>
        {(school) => <LessonView key={`${slug}/${courseSlug}/${lessonId}`} school={school} courseSlug={courseSlug} lessonId={lessonId} />}
      </SchoolGate>
    </RequireAuth>
  );
}
