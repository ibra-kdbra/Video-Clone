import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { courseSlug as courseSlugSchema, uuid } from '@grand/contracts';

import Badge from '../components/Badge.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Icon from '../components/Icon.jsx';
import Monogram from '../components/Monogram.jsx';
import RequireAuth from '../components/RequireAuth.jsx';
import SchoolGate from '../components/SchoolGate.jsx';
import { Block } from '../components/Skeleton.jsx';
import { EmptyState } from '../components/States.jsx';
import SubmissionsProblem from '../components/SubmissionsProblem.jsx';
import { SUBMISSION_STATUS, gradeLine } from '../lib/assignments.js';
import { coursePath, lessonPath, submissionPath, submissionsPath } from '../lib/courses.js';
import { formatDateTime, plural } from '../lib/format.js';
import { useAssignmentContext } from '../lib/useAssignmentContext.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import NotFound from './NotFound.jsx';
import styles from './Submissions.module.scss';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Waiting' },
  { key: 'graded', label: 'Graded' },
  { key: 'returned', label: 'Returned' },
];

/**
 * An assignment's submissions (/s/:slug/c/:course/l/:lesson/submissions), for the course's
 * editors: each student's status, when they handed in, their grade and how many files, waiting
 * ones first, filtered by Waiting, Graded or Returned. Each leads to its grading page.
 */
function SubmissionsView({ school, courseSlug, lessonId }) {
  const slug = school.slug;
  const [params] = useSearchParams();
  const { course, lesson, assignment, submissions } = useAssignmentContext(slug, courseSlug, lessonId);
  const filter = FILTERS.find((item) => item.key === params.get('status')) ?? FILTERS[0];
  const title = lesson.data?.title;
  useDocumentTitle(title ? `Submissions · ${title}` : 'Submissions');

  const failure = submissions.error ?? lesson.error ?? course.error;
  if (failure)
    return (
      <SubmissionsProblem
        error={failure}
        slug={slug}
        courseSlug={courseSlug}
        lessonId={lessonId}
        onRetry={() => [course, lesson, submissions].forEach((query) => query.isError && query.refetch())}
      />
    );

  const list = submissions.data ?? [];
  const count = (status) => list.filter((item) => item.status === status).length;
  const shown = filter.key === 'all' ? list : list.filter((item) => item.status === filter.key);
  const maxPoints = assignment.data?.maxPoints;
  const base = submissionsPath(slug, courseSlug, lessonId);

  return (
    <div className={`page ${styles.page}`}>
      <Breadcrumbs
        items={[
          { label: school.name, to: `/s/${slug}` },
          { label: course.data?.title ?? 'Course', to: coursePath(slug, courseSlug) },
          { label: title ?? 'Assignment', to: lessonPath(slug, courseSlug, lessonId) },
          { label: 'Submissions' },
        ]}
      />
      <header className={styles.header}>
        <p className={styles.eyebrow}>
          <Icon name="assignment" size={16} />
          {title ?? 'Assignment'}
        </p>
        <h1 className={styles.title}>Submissions</h1>
        {submissions.data && (
          <p className={`${styles.facts} tabular`}>
            {count('submitted')} waiting · {count('graded')} graded · {count('returned')} returned
            {maxPoints ? ` · out of ${maxPoints} points` : ''}
          </p>
        )}
      </header>

      <nav className={styles.filters} aria-label="Show submissions">
        {FILTERS.map((item) => {
          const n = item.key === 'all' ? list.length : count(item.key);
          return (
            <Link
              key={item.key}
              to={item.key === 'all' ? base : `${base}?status=${item.key}`}
              replace
              className={styles.filter}
              aria-current={item.key === filter.key ? 'page' : undefined}
            >
              {item.label}
              {submissions.data && <span className={`${styles.filterCount} tabular`}>{n}</span>}
            </Link>
          );
        })}
      </nav>

      {submissions.isPending ? (
        <div aria-busy="true">
          <Block height="16rem" radius="var(--radius-lg)" />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon="assignment" title={list.length === 0 ? 'Nothing handed in yet' : `No ${filter.label.toLowerCase()} submissions`} titleAs="h2">
          {list.length === 0 ? "When students hand in their work, it's listed here, waiting ones first." : 'Try another filter.'}
        </EmptyState>
      ) : (
        <table className={styles.table}>
          <caption className="visually-hidden">
            {filter.key === 'all' ? 'Every submission' : `${filter.label} submissions`}, waiting ones first
          </caption>
          <thead>
            <tr>
              <th scope="col">Student</th>
              <th scope="col">Status</th>
              <th scope="col">Handed in</th>
              <th scope="col">Grade</th>
              <th scope="col">Files</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => {
              const status = SUBMISSION_STATUS[item.status];
              return (
                <tr key={item.id} data-status={item.status}>
                  <th scope="row" className={styles.student}>
                    <Monogram name={item.student.name} seed={item.student.id} size={36} letters={1} round />
                    <span className={styles.who}>
                      <Link to={submissionPath(slug, courseSlug, lessonId, item.id)} className={styles.link}>
                        {item.student.name}
                      </Link>
                      <span className={styles.email}>{item.student.email}</span>
                    </span>
                  </th>
                  <td data-label="Status">
                    <Badge tone={status.tone} icon={status.icon}>
                      {status.label}
                    </Badge>
                  </td>
                  <td data-label="Handed in" className="tabular">
                    {formatDateTime(item.submittedAt) || '—'}
                  </td>
                  <td data-label="Grade" className="tabular">
                    {item.grade !== null && item.status === 'graded' && maxPoints ? gradeLine(item.grade, maxPoints) : '—'}
                  </td>
                  <td data-label="Files" className="tabular">
                    {item.fileCount ? plural(item.fileCount, 'file') : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Submissions() {
  const { slug = '', courseSlug = '', lessonId = '' } = useParams();
  const parsed = courseSlugSchema.safeParse(courseSlug);
  if (!parsed.success || !uuid.safeParse(lessonId).success) return <NotFound title="Not found">This address doesn't point to an assignment.</NotFound>;
  if (parsed.data !== courseSlug) return <Navigate to={submissionsPath(slug, parsed.data, lessonId)} replace />;
  return (
    <RequireAuth>
      <SchoolGate slug={slug} fallback={<div className="page" aria-busy="true" />}>
        {(school) => <SubmissionsView key={`${slug}/${courseSlug}/${lessonId}`} school={school} courseSlug={courseSlug} lessonId={lessonId} />}
      </SchoolGate>
    </RequireAuth>
  );
}
