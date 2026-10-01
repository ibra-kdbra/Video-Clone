import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';
import { courseSlug as courseSlugSchema, uuid } from '@grand/contracts';

import Badge from '../components/Badge.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Button from '../components/Button.jsx';
import { FormAlert, TextAreaField, TextField } from '../components/Field.jsx';
import Icon from '../components/Icon.jsx';
import Monogram from '../components/Monogram.jsx';
import RequireAuth from '../components/RequireAuth.jsx';
import SchoolGate from '../components/SchoolGate.jsx';
import { Block } from '../components/Skeleton.jsx';
import SubmissionsProblem from '../components/SubmissionsProblem.jsx';
import { SUBMISSION_STATUS, formatPoints, gradeLine, readGrade } from '../lib/assignments.js';
import { coursePath, keys, lessonPath, submissionPath, submissionsPath } from '../lib/courses.js';
import { formatBytes, formatDateTime, joinMeta } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { downloadSubmissionFile, getSubmission, gradeSubmission } from '../lib/learning.js';
import { toast } from '../lib/toast.js';
import { useAssignmentContext } from '../lib/useAssignmentContext.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import NotFound from './NotFound.jsx';
import styles from './Grading.module.scss';

const noRetryOn4xx = (failures, error) => failures < 1 && (error?.status === 0 || error?.status >= 500);

/** The grade and feedback, and the two ways to finish: return for changes, or save the grade. */
function GradeForm({ submission, maxPoints, onGrade, resultRef, result }) {
  const [grade, setGrade] = useState(submission.grade === null ? '' : String(submission.grade));
  const [feedback, setFeedback] = useState(submission.feedback);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(null);
  const gradeRef = useRef(null);
  const formId = useId();

  const finish = async (status) => {
    if (busy) return;
    const read = readGrade(grade, maxPoints, { required: status === 'graded' });
    if (read.error) {
      setErrors({ grade: read.error });
      gradeRef.current?.focus();
      return;
    }
    setErrors({});
    setBusy(status);
    try {
      await onGrade({ status, grade: read.grade, feedback: feedback.trim() });
    } catch (error) {
      const field = error?.details?.find((detail) => detail.path === 'grade' || detail.path === 'feedback');
      if (field) {
        setErrors({ [field.path]: field.message });
        if (field.path === 'grade') gradeRef.current?.focus();
      } else setErrors({ '': errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      id={formId}
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        finish('graded');
      }}
      aria-labelledby={`${formId}-title`}
    >
      <h2 id={`${formId}-title`} className={styles.formTitle}>
        Grade
      </h2>
      <FormAlert>{errors['']}</FormAlert>
      <TextField
        ref={gradeRef}
        label="Grade"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={grade}
        error={errors.grade}
        hint={`Out of ${formatPoints(maxPoints)}. Decimals are fine, like 8.5.`}
        onChange={(event) => {
          setGrade(event.target.value);
          if (errors.grade) setErrors((current) => ({ ...current, grade: undefined }));
        }}
        trailing={<span className={`${styles.outOf} tabular`}>/ {formatPoints(maxPoints)}</span>}
      />
      <TextAreaField
        label="Feedback"
        rows={7}
        maxLength={10_000}
        value={feedback}
        error={errors.feedback}
        hint="The student sees this with their grade, or when it's returned to them."
        onChange={(event) => setFeedback(event.target.value)}
      />
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" icon="check" busy={busy === 'graded'}>
          Save grade
        </Button>
        <Button variant="secondary" icon="refresh" busy={busy === 'returned'} onClick={() => finish('returned')}>
          Return for changes
        </Button>
      </div>
      <p ref={resultRef} tabIndex={-1} className={styles.result} role="status">
        {result}
      </p>
    </form>
  );
}

/**
 * Grading one submission (/s/:slug/c/:course/l/:lesson/submissions/:submission), for the course's
 * editors: who handed it in and when, their written answer and files (downloaded through
 * short-lived links), then a grade (0 to the assignment's points, decimals allowed) and feedback,
 * saved as the grade or returned to the student for changes. Previous and next lead through the
 * submissions in the list's order, waiting ones first.
 */
function GradingView({ school, courseSlug, lessonId, submissionId }) {
  const queryClient = useQueryClient();
  const slug = school.slug;
  const { course, lesson, assignment, submissions } = useAssignmentContext(slug, courseSlug, lessonId);
  const key = keys.submission(slug, courseSlug, lessonId, submissionId);
  const submission = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getSubmission(slug, courseSlug, lessonId, submissionId, signal),
    staleTime: 15_000,
    retry: noRetryOn4xx,
  });
  const [result, setResult] = useState('');
  const resultRef = useRef(null);
  const focusResult = useRef(false);
  const s = submission.data;
  useDocumentTitle(s ? `Grading ${s.student.name}` : 'Grading');

  useEffect(() => {
    if (!focusResult.current) return;
    focusResult.current = false;
    resultRef.current?.focus();
  }, [result]);

  const failure = submission.error ?? submissions.error ?? lesson.error;
  if (failure)
    return (
      <SubmissionsProblem
        error={failure}
        what="submission"
        slug={slug}
        courseSlug={courseSlug}
        lessonId={lessonId}
        onRetry={() => [submission, submissions, lesson].forEach((query) => query.isError && query.refetch())}
      />
    );

  const list = submissions.data ?? [];
  const index = list.findIndex((item) => item.id === submissionId);
  const previous = index > 0 ? list[index - 1] : null;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null;
  const nextWaiting = list.find((item) => item.status === 'submitted' && item.id !== submissionId);
  const maxPoints = assignment.data?.maxPoints;
  const title = lesson.data?.title;

  const grade = async (input) => {
    const saved = await gradeSubmission(slug, courseSlug, lessonId, submissionId, input);
    queryClient.setQueryData(key, saved);
    queryClient.setQueryData(keys.submissions(slug, courseSlug, lessonId), (current) =>
      current?.map((item) => (item.id === saved.id ? { ...item, status: saved.status, grade: saved.grade, gradedAt: saved.gradedAt } : item)),
    );
    queryClient.invalidateQueries({ queryKey: keys.assignment(slug, courseSlug, lessonId) });
    queryClient.invalidateQueries({ queryKey: keys.insights(slug, courseSlug) });
    const message =
      saved.status === 'graded' ? `Grade saved: ${gradeLine(saved.grade, maxPoints)} for ${saved.student.name}` : `Returned to ${saved.student.name} for changes`;
    toast(message);
    focusResult.current = true;
    setResult(`${message}. ${saved.student.name} has been told.`);
  };

  const status = s ? SUBMISSION_STATUS[s.status] : null;
  return (
    <div className={`page ${styles.page}`}>
      <Breadcrumbs
        items={[
          { label: course.data?.title ?? 'Course', to: coursePath(slug, courseSlug) },
          { label: title ?? 'Assignment', to: lessonPath(slug, courseSlug, lessonId) },
          { label: 'Submissions', to: submissionsPath(slug, courseSlug, lessonId) },
          { label: s?.student.name ?? 'Submission' },
        ]}
      />

      {!s ? (
        <div aria-busy="true" className={styles.loading}>
          <Block width="min(20rem, 70%)" height="2.4rem" />
          <Block height="16rem" radius="var(--radius-lg)" />
        </div>
      ) : (
        <>
          <header className={styles.header}>
            <Monogram name={s.student.name} seed={s.student.id} size={56} letters={1} round />
            <div className={styles.who}>
              <p className={styles.eyebrow}>
                <Icon name="assignment" size={16} />
                {title ?? 'Assignment'}
              </p>
              <h1 className={styles.title}>{s.student.name}</h1>
              <p className={styles.meta}>
                <span className={styles.email}>{s.student.email}</span>
                <Badge tone={status.tone} icon={status.icon}>
                  {status.label}
                </Badge>
                {s.status === 'graded' && maxPoints && <span className={`${styles.gradeNow} tabular`}>{gradeLine(s.grade, maxPoints)}</span>}
              </p>
              <p className={styles.dates}>
                {joinMeta(s.submittedAt && `Handed in ${formatDateTime(s.submittedAt)}`, s.gradedAt && `${s.status === 'returned' ? 'Returned' : 'Graded'} ${formatDateTime(s.gradedAt)}`)}
              </p>
            </div>
          </header>

          {list.length > 0 && (
            <nav className={styles.steps} aria-label="Other submissions">
              {previous ? (
                <Link to={submissionPath(slug, courseSlug, lessonId, previous.id)} className={styles.step} rel="prev">
                  <Icon name="chevronLeft" size={18} />
                  <span className={styles.stepText}>
                    <span className={styles.stepLabel}>Previous</span>
                    <span className={styles.stepName}>{previous.student.name}</span>
                  </span>
                </Link>
              ) : (
                <span />
              )}
              <p className={`${styles.position} tabular`}>{index >= 0 ? `${index + 1} of ${list.length}` : ''}</p>
              {next ? (
                <Link to={submissionPath(slug, courseSlug, lessonId, next.id)} className={`${styles.step} ${styles.nextStep}`} rel="next">
                  <span className={styles.stepText}>
                    <span className={styles.stepLabel}>Next</span>
                    <span className={styles.stepName}>{next.student.name}</span>
                  </span>
                  <Icon name="chevronRight" size={18} />
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}

          <div className={styles.split}>
            <div className={styles.work}>
              {s.status === 'draft' && <p className={styles.note}>This work hasn't been handed in yet, so it can't be graded.</p>}
              <section className={styles.card} aria-labelledby="answer-title">
                <h2 id="answer-title" className={styles.cardTitle}>
                  Written answer
                </h2>
                {s.body.trim() ? <p className={styles.answer}>{s.body}</p> : <p className={styles.muted}>No written answer.</p>}
              </section>
              <section className={styles.card} aria-labelledby="files-title">
                <h2 id="files-title" className={styles.cardTitle}>
                  Files
                </h2>
                {s.files.filter((file) => file.uploaded).length === 0 ? (
                  <p className={styles.muted}>No files.</p>
                ) : (
                  <ul className={styles.files}>
                    {s.files
                      .filter((file) => file.uploaded)
                      .map((file) => (
                        <li key={file.id} className={styles.file}>
                          <Icon name="file" size={20} className={styles.fileIcon} />
                          <span className={styles.fileText}>
                            <span className={styles.fileName}>{file.fileName}</span>
                            <span className={`${styles.fileMeta} tabular`}>{formatBytes(file.sizeBytes)}</span>
                          </span>
                          <Button
                            size="sm"
                            variant="secondary"
                            icon="download"
                            aria-label={`Download ${file.fileName}`}
                            onClick={() =>
                              downloadSubmissionFile(slug, courseSlug, lessonId, s.id, file.id).catch((error) => toast(errorMessage(error), { tone: 'error' }))
                            }
                          >
                            <span className={styles.wideOnly}>Download</span>
                          </Button>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
            </div>

            <aside className={styles.side}>
              {s.status !== 'draft' && maxPoints ? (
                <GradeForm key={s.id} submission={s} maxPoints={maxPoints} onGrade={grade} resultRef={resultRef} result={result} />
              ) : (
                !maxPoints && <Block height="18rem" radius="var(--radius-lg)" />
              )}
              {nextWaiting && result && (
                <Button variant="secondary" icon="chevronRight" to={submissionPath(slug, courseSlug, lessonId, nextWaiting.id)}>
                  Next waiting: {nextWaiting.student.name}
                </Button>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

export default function Grading() {
  const { slug = '', courseSlug = '', lessonId = '', submissionId = '' } = useParams();
  const parsed = courseSlugSchema.safeParse(courseSlug);
  if (!parsed.success || !uuid.safeParse(lessonId).success || !uuid.safeParse(submissionId).success)
    return <NotFound title="Not found">This address doesn't point to a submission.</NotFound>;
  if (parsed.data !== courseSlug) return <Navigate to={submissionPath(slug, parsed.data, lessonId, submissionId)} replace />;
  return (
    <RequireAuth>
      <SchoolGate slug={slug} fallback={<div className="page" aria-busy="true" />}>
        {(school) => (
          <GradingView key={`${slug}/${courseSlug}/${lessonId}/${submissionId}`} school={school} courseSlug={courseSlug} lessonId={lessonId} submissionId={submissionId} />
        )}
      </SchoolGate>
    </RequireAuth>
  );
}
