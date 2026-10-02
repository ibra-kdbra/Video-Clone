import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';
import { courseSlug as courseSlugSchema } from '@grand/contracts';

import Badge from '../components/Badge.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Button from '../components/Button.jsx';
import CourseTabs from '../components/CourseTabs.jsx';
import Markdown from '../components/Markdown.jsx';
import RequireAuth from '../components/RequireAuth.jsx';
import SchoolGate from '../components/SchoolGate.jsx';
import { Block } from '../components/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/States.jsx';
import { coursePath, getCourse, keys } from '../lib/courses.js';
import { REPORT_REASON_LABELS, discussionKeys, discussionsPath, patchPages, postPath, resolveReport, withoutReports } from '../lib/discussions.js';
import { plural, timeAgo } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { toast } from '../lib/toast.js';
import { useCourseWatch } from '../lib/useCourseWatch.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useOpenReports } from '../lib/useOpenReports.js';
import NotFound from './NotFound.jsx';
import styles from './Discussions.module.scss';

const noRetryOn4xx = (failures, error) => failures < 1 && (error?.status === 0 || error?.status >= 500);

/** Where the reported post is: its thread, or the lesson it's under. */
function contextLabel(context) {
  if (context.lessonId) return `Comment under “${context.lessonTitle ?? 'a lesson'}”`;
  return context.threadTitle ? `In “${context.threadTitle}”` : 'In a thread';
}

/** One report: why, by whom, the post itself, and Hide or Dismiss. */
function ReportCard({ slug, courseSlug, report, busy, onResolve }) {
  const { post, context } = report;
  const to = postPath(slug, courseSlug, { lessonId: context.lessonId, threadId: context.threadId, postId: post.id });
  return (
    <li tabIndex={-1} className={styles.report}>
      <p className={styles.reportHead}>
        <Badge tone="danger" icon="flag">
          {REPORT_REASON_LABELS[report.reason] ?? report.reason}
        </Badge>
        <span className={styles.reportWho}>
          {report.reporter ? `Reported by ${report.reporter.name}` : 'Reported'} <time dateTime={report.createdAt}>{timeAgo(report.createdAt)}</time>
        </span>
        {post.status === 'hidden' && (
          <Badge tone="warning" icon="eyeOff">
            Already hidden
          </Badge>
        )}
      </p>
      {report.note && <p className={styles.reportNote}>{report.note}</p>}
      <div className={styles.reported}>
        <p className={styles.rowMeta}>
          <span className={styles.rowAuthor}>{post.author?.name ?? 'Former member'}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
          <span aria-hidden="true">·</span>
          <span>{contextLabel(context)}</span>
        </p>
        {post.status === 'deleted' ? <p className={styles.rowExcerpt}>The post was deleted.</p> : <Markdown headingOffset={3}>{post.body}</Markdown>}
      </div>
      <div className={styles.reportActions}>
        {post.status === 'visible' && (
          <Button size="sm" variant="danger" icon="eyeOff" busy={busy === `hide:${report.id}`} onClick={() => onResolve(report, 'hide')}>
            Hide post
          </Button>
        )}
        <Button size="sm" variant="secondary" icon="check" busy={busy === `dismiss:${report.id}`} onClick={() => onResolve(report, 'dismiss')}>
          {post.status === 'visible' ? 'Dismiss: it’s fine' : 'Mark as dealt with'}
        </Button>
        <Link to={to} className={`${styles.context} ${styles.open}`}>
          See it in place
        </Link>
      </div>
    </li>
  );
}

/**
 * The open reports of a course's discussions (/s/:slug/c/:course/discussions/reports), for its
 * moderators: each with the reason, the reporter's note, the post and where it is, and two ways
 * to deal with it: hide the post (every report about it closes), or dismiss the report.
 */
function ReportsView({ school, courseSlug }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState('');
  const heading = useRef(null);
  const listRef = useRef(null);
  const slug = school.slug;

  const course = useQuery({
    queryKey: keys.course(slug, courseSlug),
    queryFn: ({ signal }) => getCourse(slug, courseSlug, signal),
    staleTime: 30_000,
    retry: noRetryOn4xx,
  });
  const c = course.data;
  const reports = useOpenReports(slug, courseSlug, Boolean(c?.canEdit));
  useDocumentTitle(c ? `Reports · ${c.title}` : 'Reports');
  useCourseWatch({ slug, courseSlug, courseId: c?.id, enabled: Boolean(c?.canEdit) });

  const resolve = async (report, action) => {
    setBusy(`${action}:${report.id}`);
    const items = reports.data ?? [];
    const index = items.indexOf(report);
    try {
      await resolveReport(slug, courseSlug, report.id, action);
      const postId = action === 'hide' ? report.post.id : null;
      queryClient.setQueryData(discussionKeys.reports(slug, courseSlug), (current) => withoutReports(current, { reportId: report.id, postId }));
      if (postId) {
        queryClient.setQueriesData({ queryKey: discussionKeys.lists(slug, courseSlug) }, (data) => patchPages(data, postId, { status: 'hidden' }));
        queryClient.invalidateQueries({ queryKey: discussionKeys.thread(slug, courseSlug, report.context.threadId) });
      }
      const message = action === 'hide' ? 'Post hidden. Its reports are closed.' : 'Report dismissed';
      toast(message);
      setStatus(message);
      // Focus moves on to the next report, or to the heading when none is left.
      requestAnimationFrame(() => {
        const rows = listRef.current?.querySelectorAll(':scope > li');
        const next = rows?.[Math.min(index, (rows?.length ?? 1) - 1)];
        (next ?? heading.current)?.focus();
      });
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
      if (error?.status === 409) queryClient.invalidateQueries({ queryKey: discussionKeys.reports(slug, courseSlug) });
    } finally {
      setBusy(null);
    }
  };

  if (course.isError && course.error.status === 404)
    return (
      <NotFound title="Course not found">
        This course doesn't exist. <Link to={`/s/${slug}`}>See {school.name}'s courses</Link>.
      </NotFound>
    );

  const items = reports.data ?? [];
  return (
    <div className={`page ${styles.page}`}>
      <Breadcrumbs
        items={[
          { label: school.name, to: `/s/${slug}` },
          { label: c?.title ?? 'Course', to: coursePath(slug, courseSlug) },
          { label: 'Discussion', to: discussionsPath(slug, courseSlug) },
          { label: 'Reports' },
        ]}
      />
      <header className={styles.header}>
        <div className={styles.titles}>
          <div className={styles.eyebrow}>{c ? c.title : <Block width="10rem" height="0.9rem" />}</div>
          <h1 ref={heading} tabIndex={-1} className={styles.title}>
            Reports
          </h1>
          {reports.data && (
            <p className={`${styles.rowMeta} tabular`}>{items.length ? `${plural(items.length, 'open report')} to look at` : 'Nothing waiting'}</p>
          )}
        </div>
      </header>
      {c?.canEdit && <CourseTabs slug={slug} course={c} current="discussion" />}

      {course.isPending || (c?.canEdit && reports.isPending) ? (
        <Block height="12rem" radius="var(--radius-lg)" />
      ) : course.isError ? (
        <ErrorState title="Couldn't load this course" error={course.error} onRetry={() => course.refetch()} />
      ) : !c.canEdit ? (
        <EmptyState icon="lock" title="For the course's instructors">
          Only the people who run this course see the reports about its discussion.
        </EmptyState>
      ) : reports.isError ? (
        <ErrorState title="Couldn't load the reports" error={reports.error} onRetry={() => reports.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="checkCircle" title="No open reports" action={<Button to={discussionsPath(slug, courseSlug)}>Back to the discussion</Button>}>
          When someone reports a post in this course, it will be here for you to look at.
        </EmptyState>
      ) : (
        <ul ref={listRef} className={styles.reports}>
          {items.map((report) => (
            <ReportCard key={report.id} slug={slug} courseSlug={courseSlug} report={report} busy={busy} onResolve={resolve} />
          ))}
        </ul>
      )}
      <p className="visually-hidden" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

export default function DiscussionReports() {
  const { slug = '', courseSlug = '' } = useParams();
  const parsed = courseSlugSchema.safeParse(courseSlug);
  if (!parsed.success) return <NotFound title="Course not found">This address doesn't point to a course.</NotFound>;
  if (parsed.data !== courseSlug) return <Navigate to={`${discussionsPath(slug, parsed.data)}/reports`} replace />;
  return (
    <RequireAuth>
      <SchoolGate slug={slug} fallback={<div className="page" aria-busy="true" />}>
        {(school) => <ReportsView key={`${slug}/${courseSlug}`} school={school} courseSlug={courseSlug} />}
      </SchoolGate>
    </RequireAuth>
  );
}
