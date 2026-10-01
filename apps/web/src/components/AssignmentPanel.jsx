import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_SUBMISSION_FILES } from '@grand/contracts';

import { SUBMISSION_ACCEPT, SUBMISSION_STATUS, dueLabel, gradeLine, isEditable, sortFiles, uploadSubmissionFile } from '../lib/assignments.js';
import { keys, submissionsPath } from '../lib/courses.js';
import { formatBytes, formatDateTime, plural } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import {
  applyProgress,
  downloadSubmissionFile,
  getAssignment,
  saveSubmission,
  saveSubmissionOnExit,
  submissionFileEndpoints,
  submitAssignment,
} from '../lib/learning.js';
import { toast } from '../lib/toast.js';
import { useAutosave } from '../lib/useAutosave.js';
import Badge from './Badge.jsx';
import Button from './Button.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { TextAreaField } from './Field.jsx';
import Icon from './Icon.jsx';
import ProgressBar from './ProgressBar.jsx';
import { Block } from './Skeleton.jsx';
import { ErrorState } from './States.jsx';
import styles from './AssignmentPanel.module.scss';

const SAVE_STATUS = {
  saved: 'Saved',
  dirty: 'Not saved yet',
  saving: 'Saving…',
  error: "Couldn't save. Your text is still here.",
};

/** "A written answer and files", "Files only"…: what can be handed in. */
const handInKinds = (assignment) =>
  assignment.allowText && assignment.allowFiles ? 'A written answer, files, or both' : assignment.allowText ? 'A written answer' : 'Files';

/** Points, due date and what to hand in. */
function AssignmentFacts({ assignment, handedIn }) {
  const due = dueLabel(assignment.dueAt);
  return (
    <dl className={styles.facts}>
      <div>
        <dt>Points</dt>
        <dd className="tabular">{assignment.maxPoints}</dd>
      </div>
      <div>
        <dt>Due</dt>
        <dd>
          {assignment.dueAt ? (
            <>
              <span className="tabular">{formatDateTime(assignment.dueAt)}</span>
              {due && !handedIn && (
                <Badge tone={due.tone} icon={due.overdue ? 'alert' : 'clock'} className={styles.due}>
                  {due.text}
                </Badge>
              )}
            </>
          ) : (
            'No due date'
          )}
        </dd>
      </div>
      <div>
        <dt>Hand in</dt>
        <dd>{handInKinds(assignment)}</dd>
      </div>
    </dl>
  );
}

/** For the course's editors: how many are waiting to be graded, and the way to them. */
function ToGrade({ counts, href }) {
  return (
    <section className={styles.toGrade} aria-labelledby="to-grade-title">
      <div className={styles.toGradeText}>
        <h2 id="to-grade-title" className={styles.toGradeCount}>
          <span className="tabular">{counts.submitted}</span> to grade
        </h2>
        <p className={`${styles.muted} tabular`}>
          {counts.graded} graded · {counts.returned} returned for changes
        </p>
      </div>
      <Button variant={counts.submitted ? 'primary' : 'secondary'} icon="assignment" to={href}>
        See submissions
      </Button>
    </section>
  );
}

/** The grade and the feedback, once graded; the feedback alone when returned. */
function Feedback({ submission, maxPoints }) {
  const graded = submission.status === 'graded';
  return (
    <div className={styles.feedback} data-status={submission.status}>
      {graded && (
        <p className={styles.grade}>
          <span className={styles.gradeLabel}>Grade</span>
          <span className={`${styles.gradeValue} tabular`}>{gradeLine(submission.grade ?? 0, maxPoints)}</span>
          {submission.gradedAt && <span className={styles.muted}>{formatDateTime(submission.gradedAt)}</span>}
        </p>
      )}
      {!graded && <p className={styles.returnedNote}>Returned for changes. Read the feedback, change your work, and hand it in again.</p>}
      {submission.feedback.trim() ? (
        <div className={styles.feedbackText}>
          <p className={styles.feedbackLabel}>Feedback</p>
          <p className={styles.plain}>{submission.feedback}</p>
        </div>
      ) : (
        graded && <p className={styles.muted}>No written feedback.</p>
      )}
    </div>
  );
}

/** Pick or drop files; they're checked here (type, size, count) before anything is sent. */
function FilePicker({ room, onFiles }) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  return (
    <div
      className={styles.drop}
      data-over={over || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onFiles([...(event.dataTransfer.files ?? [])]);
      }}
    >
      <Icon name="upload" size={22} className={styles.dropIcon} />
      <p className={styles.dropText}>
        Drop files here, or{' '}
        <input
          id={inputId}
          type="file"
          multiple
          accept={SUBMISSION_ACCEPT}
          className={`visually-hidden ${styles.file}`}
          onChange={(event) => {
            onFiles([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
        <label htmlFor={inputId} className={styles.choose}>
          choose files
        </label>
      </p>
      <p className={styles.dropHint}>
        PDF, documents, images, ZIP, MP3 or MP4, up to 25 MB each. {plural(room, 'more file')} can be added.
      </p>
    </div>
  );
}

/** The files of the submission, and those on their way. */
function Files({ submission, uploads, editable, onRemove, onDownload, onCancel, removing, headingRef }) {
  const files = submission?.files ?? [];
  if (!files.length && !uploads.length) return null;
  return (
    <ul className={styles.fileList} aria-labelledby={headingRef ? 'files-title' : undefined}>
      {files.map((file) => (
        <li key={file.id} className={styles.fileRow}>
          <Icon name="file" size={20} className={styles.fileIcon} />
          <span className={styles.fileText}>
            <span className={styles.fileName}>{file.fileName}</span>
            <span className={`${styles.fileMeta} tabular`}>{file.uploaded ? formatBytes(file.sizeBytes) : "This upload didn't finish. Remove it and add the file again."}</span>
          </span>
          <span className={styles.fileActions}>
            {file.uploaded && submission && (
              <Button size="sm" variant="ghost" icon="download" onClick={() => onDownload(file)} aria-label={`Download ${file.fileName}`}>
                <span className={styles.wideOnly}>Download</span>
              </Button>
            )}
            {editable && (
              <Button size="sm" variant="ghost" icon="trash" busy={removing === file.id} onClick={() => onRemove(file)} aria-label={`Remove ${file.fileName}`}>
                <span className={styles.wideOnly}>Remove</span>
              </Button>
            )}
          </span>
        </li>
      ))}
      {uploads.map((upload) => {
        const percent = upload.size ? Math.round((upload.loaded / upload.size) * 100) : 0;
        return (
          <li key={upload.key} className={styles.fileRow} data-uploading>
            <Icon name="upload" size={20} className={styles.fileIcon} />
            <span className={styles.fileText}>
              <span className={styles.fileName}>{upload.name}</span>
              <ProgressBar value={percent} label={`Uploading ${upload.name}`} valueText={`${percent}%`} />
              <span className={`${styles.fileMeta} tabular`}>
                {percent >= 100 ? 'Checking…' : `${percent}% of ${formatBytes(upload.size)}`}
              </span>
            </span>
            <span className={styles.fileActions}>
              <Button size="sm" variant="ghost" icon="close" onClick={() => onCancel(upload)} aria-label={`Cancel uploading ${upload.name}`}>
                <span className={styles.wideOnly}>Cancel</span>
              </Button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * An enrolled student's own work: the status, the written answer (saved as they type), files
 * (uploaded straight to storage), and Hand in. Graded work shows the grade and feedback; returned
 * work shows the feedback and can be changed and handed in again.
 */
function SubmissionPanel({ school, courseSlug, lesson, assignment, setSubmission }) {
  const queryClient = useQueryClient();
  const slug = school.slug;
  const submission = assignment.submission;
  const editable = isEditable(submission);
  const status = SUBMISSION_STATUS[submission?.status ?? 'draft'];
  const heading = useRef(null);
  const filesHeading = useRef(null);
  const textId = useId();
  const [uploads, setUploads] = useState([]);
  const [problems, setProblems] = useState([]);
  const [removing, setRemoving] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const focusAfter = useRef(false);

  const answer = useAutosave({
    initial: submission?.body ?? '',
    save: async (body) => setSubmission(await saveSubmission(slug, courseSlug, lesson.id, body)),
    saveOnExit: (body) => saveSubmissionOnExit(slug, courseSlug, lesson.id, body),
  });

  // After handing in, focus goes to the work's heading, which now says it's handed in.
  useEffect(() => {
    if (!focusAfter.current) return;
    focusAfter.current = false;
    heading.current?.focus();
  }, [submission?.status]);

  const endpoints = submissionFileEndpoints(slug, courseSlug, lesson.id);
  const uploadedFiles = (submission?.files ?? []).filter((file) => file.uploaded);
  const count = (submission?.files?.length ?? 0) + uploads.length;

  const addFiles = (files) => {
    const { accepted, problems: found } = sortFiles(files, count);
    setProblems(found);
    for (const file of accepted) {
      const controller = new AbortController();
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      setUploads((list) => [...list, { key, name: file.name, size: file.size, loaded: 0, controller }]);
      const patch = (change) => setUploads((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)));
      uploadSubmissionFile(file, {
        api: endpoints,
        signal: controller.signal,
        onProgress: (loaded) => patch({ loaded }),
      })
        .then((updated) => {
          setSubmission(updated);
          toast(`${file.name} added`);
        })
        .catch((error) => {
          if (error?.name === 'AbortError') toast('Upload cancelled', { tone: 'info' });
          else setProblems((list) => [...list, { name: file.name, problem: errorMessage(error) }]);
          // The half-made file is gone on the server; the list catches up.
          queryClient.invalidateQueries({ queryKey: keys.assignment(slug, courseSlug, lesson.id) });
        })
        .finally(() => setUploads((list) => list.filter((item) => item.key !== key)));
    }
  };

  const remove = async (file) => {
    setRemoving(file.id);
    try {
      setSubmission(await endpoints.remove(file.id));
      toast(`${file.fileName} removed`);
      filesHeading.current?.focus();
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setRemoving(null);
    }
  };

  const download = (file) =>
    downloadSubmissionFile(slug, courseSlug, lesson.id, submission.id, file.id).catch((error) => toast(errorMessage(error), { tone: 'error' }));

  const handIn = useMutation({
    mutationFn: async () => {
      await answer.flush();
      return submitAssignment(slug, courseSlug, lesson.id);
    },
    onSuccess: (updated) => {
      setConfirm(false);
      focusAfter.current = true;
      setSubmission(updated);
      applyProgress(queryClient, slug, courseSlug, lesson.id, {
        lessonId: lesson.id,
        completed: true,
        completedAt: updated.submittedAt,
        percent: 100,
        positionSeconds: 0,
      });
      toast('Handed in');
    },
    onError: (error) => {
      setConfirm(false);
      toast(errorMessage(error), { tone: 'error' });
    },
  });

  const hasText = assignment.allowText && answer.value.trim().length > 0;
  const hasFiles = assignment.allowFiles && uploadedFiles.length > 0;
  const ready = (hasText || hasFiles) && uploads.length === 0;
  const handInHint =
    uploads.length > 0
      ? 'Wait for your files to finish uploading.'
      : !hasText && !hasFiles
        ? assignment.allowText && assignment.allowFiles
          ? 'Write your answer or add a file to hand it in.'
          : assignment.allowText
            ? 'Write your answer to hand it in.'
            : 'Add a file to hand it in.'
        : null;
  const summary = [hasText && 'your written answer', hasFiles && plural(uploadedFiles.length, 'file')].filter(Boolean).join(' and ');

  return (
    <section className={styles.card} aria-labelledby="work-title">
      <div className={styles.cardHead}>
        <h2 id="work-title" ref={heading} tabIndex={-1} className={styles.title}>
          Your work
        </h2>
        <Badge tone={status.tone} icon={status.icon}>
          {status.label}
        </Badge>
      </div>

      {submission?.status === 'submitted' && (
        <p className={styles.handedIn}>
          <Icon name="checkCircle" size={18} />
          <span>Handed in {formatDateTime(submission.submittedAt)}. You'll hear when it's graded.</span>
        </p>
      )}
      {(submission?.status === 'graded' || submission?.status === 'returned') && <Feedback submission={submission} maxPoints={assignment.maxPoints} />}

      {assignment.allowText &&
        (editable ? (
          <TextAreaField
            id={textId}
            label="Your answer"
            rows={9}
            maxLength={20_000}
            value={answer.value}
            onChange={(event) => answer.setValue(event.target.value)}
            onBlur={() => answer.flush().catch(() => {})}
            hint="Your answer is saved as you type."
            labelExtra={
              <span className={styles.saveState} data-state={answer.status} aria-live="polite">
                {answer.status === 'error' ? (
                  <button type="button" className={styles.retry} onClick={() => answer.flush().catch(() => {})}>
                    {SAVE_STATUS.error} Try again
                  </button>
                ) : (
                  SAVE_STATUS[answer.status]
                )}
              </span>
            }
          />
        ) : (
          <div className={styles.readOnly}>
            <p className={styles.fieldLabel}>Your answer</p>
            {submission?.body.trim() ? <p className={styles.plain}>{submission.body}</p> : <p className={styles.muted}>No written answer.</p>}
          </div>
        ))}

      {assignment.allowFiles && (
        <div className={styles.files}>
          <div className={styles.filesHead}>
            <h3 id="files-title" ref={filesHeading} tabIndex={-1} className={styles.subTitle}>
              Files
            </h3>
            <span className={`${styles.muted} tabular`}>
              {count} of {MAX_SUBMISSION_FILES}
            </span>
          </div>
          <Files
            submission={submission}
            uploads={uploads}
            editable={editable}
            removing={removing}
            onRemove={remove}
            onDownload={download}
            onCancel={(upload) => upload.controller.abort()}
            headingRef={filesHeading}
          />
          {!editable && !submission?.files?.length && <p className={styles.muted}>No files.</p>}
          {editable && count < MAX_SUBMISSION_FILES && <FilePicker room={MAX_SUBMISSION_FILES - count} onFiles={addFiles} />}
          <div role="alert" className={styles.problems}>
            {problems.length > 0 && (
              <ul>
                {problems.map((item, index) => (
                  <li key={`${item.name}-${index}`}>
                    <Icon name="alert" size={16} />
                    <span>
                      <strong>{item.name}</strong>: {item.problem}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {editable && (
        <div className={styles.handIn}>
          <Button variant="primary" icon="send" disabled={!ready} onClick={() => setConfirm(true)}>
            {submission?.status === 'returned' ? 'Hand in again' : 'Hand in'}
          </Button>
          {handInHint && <p className={styles.muted}>{handInHint}</p>}
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        tone="primary"
        title={submission?.status === 'returned' ? 'Hand in your work again?' : 'Hand in your work?'}
        confirmLabel="Hand in"
        busy={handIn.isPending}
        onConfirm={() => handIn.mutate()}
        onClose={() => setConfirm(false)}
        returnFocus={heading}
      >
        <p>
          {summary ? `You're handing in ${summary}.` : ''} You can't change it after that, unless it's returned to you.
        </p>
      </ConfirmDialog>
    </section>
  );
}

/**
 * An assignment on its lesson page: the points, the due date ("Due in 3 days", "Overdue") and
 * what can be handed in; then, for enrolled students, their own work; for the course's editors,
 * how many are waiting to be graded.
 */
export default function AssignmentPanel({ school, course, courseSlug, lesson }) {
  const queryClient = useQueryClient();
  const slug = school.slug;
  const key = keys.assignment(slug, courseSlug, lesson.id);
  const assignment = useQuery({ queryKey: key, queryFn: ({ signal }) => getAssignment(slug, courseSlug, lesson.id, signal), staleTime: 30_000 });
  const enrolled = Boolean(lesson.progressDetail);
  const setSubmission = (submission) => queryClient.setQueryData(key, (current) => current && { ...current, submission });

  if (assignment.isError) return <ErrorState title="Couldn't load this assignment" error={assignment.error} onRetry={() => assignment.refetch()} />;
  if (assignment.isPending)
    return (
      <div className={styles.panel} aria-busy="true">
        <Block height="5rem" radius="var(--radius-md)" />
        <Block height="12rem" radius="var(--radius-lg)" />
      </div>
    );

  const a = assignment.data;
  const handedIn = Boolean(a.submission && a.submission.status !== 'draft' && a.submission.status !== 'returned');
  return (
    <div className={styles.panel}>
      <AssignmentFacts assignment={a} handedIn={enrolled && handedIn} />
      {a.counts && <ToGrade counts={a.counts} href={submissionsPath(slug, courseSlug, lesson.id)} />}
      {enrolled ? (
        <SubmissionPanel school={school} courseSlug={courseSlug} lesson={lesson} assignment={a} setSubmission={setSubmission} />
      ) : (
        !course?.canEdit && (
          <p className={styles.note}>
            <Icon name="lock" size={18} />
            <span>Enroll in the course to hand in your work.</span>
          </p>
        )
      )}
    </div>
  );
}
