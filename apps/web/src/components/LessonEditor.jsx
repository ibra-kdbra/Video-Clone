import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { updateLessonInput } from '@grand/contracts';

import { deleteLesson, getLesson, getStorage, keys, kindOf, lessonPath, lessonsOf, patchLesson, updateLesson } from '../lib/courses.js';
import { errorMessage } from '../lib/forms.js';
import { lessonNumbers, locateLesson } from '../lib/outline.js';
import { toast } from '../lib/toast.js';
import { useForm } from '../lib/useForm.js';
import { getUploads } from '../lib/uploads.js';
import AssignmentSettings from './AssignmentSettings.jsx';
import Button from './Button.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import Dialog from './Dialog.jsx';
import { FormAlert, TextAreaField, TextField } from './Field.jsx';
import LessonVideoField from './LessonVideoField.jsx';
import MarkdownField from './MarkdownField.jsx';
import { Block } from './Skeleton.jsx';
import Switch from './Switch.jsx';
import styles from './LessonEditor.module.scss';

// The quiz builder is its own chunk, loaded when a quiz is opened here.
const QuizBuilder = lazy(() => import('./QuizBuilder.jsx'));

const FIELDS = ['title', 'summary', 'notes'];

/** What a lesson's deletion takes with it, by kind. */
const DELETES = {
  lesson: { short: 'its notes and video', long: 'Its notes and its video are deleted too.' },
  quiz: { short: 'its questions and attempts', long: "Its questions and every student's attempts are deleted too." },
  assignment: { short: 'its submissions and their files', long: "Its instructions and every student's work and files are deleted too." },
};

/**
 * The outline's view of a lesson, from the full lesson the API returns. Progress is left as it
 * was: an editor's answer never carries their own.
 */
const summaryOf = ({ notes: _notes, previous: _previous, next: _next, courseId: _courseId, progressDetail: _detail, progress: _progress, ...summary }) => summary;

/**
 * Title, summary and notes (a quiz's or an assignment's instructions): saved together, with the
 * button in the drawer's footer.
 */
function DetailsForm({ formId, lesson, onSubmit, onState }) {
  const form = useForm(updateLessonInput, { title: lesson.title, summary: lesson.summary, notes: lesson.notes }, FIELDS);
  const [busy, setBusy] = useState(false);
  const changes = Object.fromEntries(FIELDS.filter((field) => form.values[field] !== lesson[field]).map((field) => [field, form.values[field]]));
  const dirty = Object.keys(changes).length > 0;

  // The drawer's footer (Save changes) and its close button need to know.
  useEffect(() => onState(dirty, busy), [dirty, busy, onState]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !dirty) return;
    if (!form.validate()) return;
    setBusy(true);
    try {
      await onSubmit(changes);
    } catch (error) {
      form.fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id={formId} className={styles.form} onSubmit={submit} noValidate>
      <FormAlert>{form.errors['']}</FormAlert>
      <TextField {...form.bind('title')} label="Title" maxLength={120} autoComplete="off" required />
      <TextAreaField {...form.bind('summary')} label="Summary" rows={2} maxLength={300} hint="One or two sentences, shown under the title in the outline." />
      {lesson.kind === 'lesson' ? (
        <MarkdownField {...form.bind('notes')} label="Notes" rows={8} maxLength={50_000} />
      ) : (
        <MarkdownField
          {...form.bind('notes')}
          label="Instructions"
          rows={8}
          maxLength={50_000}
          hint={`What students should do, shown above the ${lesson.kind}. Markdown works here: **bold**, _italic_, lists, links and ## headings.`}
        />
      )}
    </form>
  );
}

/**
 * Editing one lesson, in a drawer over the course editor (?lesson=… in the address, so Back closes
 * it): its video (lessons), its questions (quizzes, with their own Save) or its settings
 * (assignments), whether it's published and a free preview (both apply at once), and its title,
 * summary and notes or instructions (saved with "Save changes"). Closing with anything unsaved
 * asks first.
 */
export default function LessonEditor({ school, course, lessonId, onClose }) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [dirty, setDirty] = useState({ dirty: false, busy: false });
  // Unsaved changes in the quiz builder or the assignment's settings.
  const [workDirty, setWorkDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Once the lesson is deleted, its row (which opened this) is gone: focus goes to the outline.
  const afterClose = useRef(null);
  const slug = school.slug;
  const courseKey = keys.course(slug, course.slug);
  const lessonKey = keys.lesson(slug, course.slug, lessonId);

  const summary = lessonsOf(course).find((item) => item.id === lessonId);
  const lesson = useQuery({ queryKey: lessonKey, queryFn: ({ signal }) => getLesson(slug, course.slug, lessonId, signal), enabled: Boolean(summary) });
  const storage = useQuery({ queryKey: keys.storage(slug), queryFn: ({ signal }) => getStorage(slug, signal), staleTime: 30_000 });
  const onFormState = useCallback(
    (isDirty, busy) => setDirty((current) => (current.dirty === isDirty && current.busy === busy ? current : { dirty: isDirty, busy })),
    [],
  );

  const saved = (updated, message) => {
    queryClient.setQueryData(lessonKey, updated);
    queryClient.setQueryData(courseKey, (current) => patchLesson(current, lessonId, summaryOf(updated)));
    queryClient.invalidateQueries({ queryKey: keys.courses(slug) });
    if (message) toast(message);
  };

  const toggle = useMutation({
    mutationFn: (change) => updateLesson(slug, course.slug, lessonId, change),
    onMutate: (change) => {
      const previous = { course: queryClient.getQueryData(courseKey), lesson: queryClient.getQueryData(lessonKey) };
      queryClient.setQueryData(courseKey, (current) => patchLesson(current, lessonId, change));
      queryClient.setQueryData(lessonKey, (current) => current && { ...current, ...change });
      return previous;
    },
    onSuccess: (updated, change) => {
      const message =
        'status' in change
          ? change.status === 'published'
            ? 'Lesson published'
            : 'Lesson unpublished'
          : change.isPreview
            ? 'Now a free preview'
            : 'No longer a free preview';
      saved(updated, message);
    },
    onError: (error, _change, previous) => {
      queryClient.setQueryData(courseKey, previous.course);
      queryClient.setQueryData(lessonKey, previous.lesson);
      toast(errorMessage(error), { tone: 'error' });
    },
  });

  const requestClose = () => {
    if (dirty.busy) return;
    if (dirty.dirty || workDirty) setConfirmClose(true);
    else onClose();
  };

  const remove = async () => {
    setDeleting(true);
    try {
      // An upload still running for this lesson would only fail once the lesson is gone.
      getUploads()
        .find((entry) => entry.lessonId === lessonId && entry.phase !== 'failed')
        ?.cancel();
      await deleteLesson(slug, course.slug, lessonId);
      queryClient.setQueryData(
        courseKey,
        (current) =>
          current && { ...current, modules: current.modules.map((module) => ({ ...module, lessons: module.lessons.filter((item) => item.id !== lessonId) })) },
      );
      // Not fetched again while this drawer closes (it would only find nothing).
      queryClient.invalidateQueries({ queryKey: lessonKey, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: keys.courses(slug) });
      queryClient.invalidateQueries({ queryKey: keys.storage(slug) });
      toast(`"${summary.title}" deleted`);
      afterClose.current = document.getElementById('outline-title');
      setConfirmDelete(false);
      onClose();
    } catch (error) {
      setConfirmDelete(false);
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  if (!summary) return null;
  const where = locateLesson(course.modules, lessonId);
  const number = lessonNumbers(course.modules).get(lessonId);
  const kind = kindOf(summary);
  const deletes = DELETES[summary.kind] ?? DELETES.lesson;

  return (
    <Dialog
      open
      variant="drawer"
      returnFocus={afterClose}
      title={summary.title}
      description={`${summary.kind === 'lesson' ? 'Lesson' : kind.label} ${number} · ${course.modules[where.moduleIndex].title}`}
      onClose={requestClose}
      footer={
        <>
          <Button variant="ghost" icon="play" to={lessonPath(slug, course.slug, lessonId)} className={styles.view}>
            View
          </Button>
          <Button variant="ghost" onClick={requestClose}>
            Close
          </Button>
          <Button type="submit" form={formId} variant="primary" busy={dirty.busy} disabled={!dirty.dirty}>
            Save changes
          </Button>
        </>
      }
    >
      <div className={styles.sections}>
        {summary.kind === 'lesson' && (
          <section className={styles.section} aria-labelledby={`${formId}-video`}>
            <h3 id={`${formId}-video`} className={styles.heading}>
              Video
            </h3>
            <LessonVideoField school={school} course={course} lesson={summary} storage={storage.data} />
          </section>
        )}

        {summary.kind === 'quiz' && (
          <section className={styles.section} aria-labelledby={`${formId}-quiz`}>
            <h3 id={`${formId}-quiz`} className={styles.heading}>
              Quiz
            </h3>
            <Suspense fallback={<Block height="12rem" radius="var(--radius-md)" />}>
              <QuizBuilder school={school} course={course} lessonId={lessonId} onDirtyChange={setWorkDirty} />
            </Suspense>
          </section>
        )}

        {summary.kind === 'assignment' && (
          <section className={styles.section} aria-labelledby={`${formId}-assignment`}>
            <h3 id={`${formId}-assignment`} className={styles.heading}>
              Assignment
            </h3>
            <AssignmentSettings school={school} course={course} lessonId={lessonId} onDirtyChange={setWorkDirty} />
          </section>
        )}

        <section className={styles.section} aria-labelledby={`${formId}-visibility`}>
          <h3 id={`${formId}-visibility`} className={styles.heading}>
            Visibility
          </h3>
          <div className={styles.switches}>
            <Switch
              label="Published"
              hint={course.status === 'published' ? 'Students see it in the course.' : 'Students will see it once the course is published too.'}
              checked={summary.status === 'published'}
              busy={toggle.isPending}
              onChange={(on) => toggle.mutate({ status: on ? 'published' : 'draft' })}
            />
            <Switch
              label="Free preview"
              hint="Members of the school can watch it without enrolling."
              checked={summary.isPreview}
              busy={toggle.isPending}
              onChange={(on) => toggle.mutate({ isPreview: on })}
            />
          </div>
        </section>

        <section className={styles.section} aria-labelledby={`${formId}-details`}>
          <h3 id={`${formId}-details`} className={styles.heading}>
            Details
          </h3>
          {lesson.data ? (
            <DetailsForm
              key={lessonId}
              formId={formId}
              lesson={lesson.data}
              onState={onFormState}
              onSubmit={async (changes) => saved(await updateLesson(slug, course.slug, lessonId, changes), 'Lesson saved')}
            />
          ) : lesson.isError ? (
            <p className={styles.error}>{errorMessage(lesson.error)}</p>
          ) : (
            <div className={styles.form} aria-busy="true">
              <Block height="4.5rem" radius="var(--radius-md)" />
              <Block height="6rem" radius="var(--radius-md)" />
              <Block height="10rem" radius="var(--radius-md)" />
            </div>
          )}
        </section>

        <section className={`${styles.section} ${styles.danger}`} aria-labelledby={`${formId}-delete`}>
          <h3 id={`${formId}-delete`} className={styles.heading}>
            Delete this {kind.label.toLowerCase()}
          </h3>
          <p className={styles.dangerText}>It's removed from the course with {deletes.short}. This can't be undone.</p>
          <Button variant="danger" size="sm" icon="trash" onClick={() => setConfirmDelete(true)}>
            Delete {kind.label.toLowerCase()}
          </Button>
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${summary.title}"?`}
        confirmLabel={`Delete ${kind.label.toLowerCase()}`}
        busy={deleting}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      >
        <p>{deletes.long} This can't be undone.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmClose}
        title="Discard your changes?"
        confirmLabel="Discard"
        onConfirm={() => {
          setConfirmClose(false);
          onClose();
        }}
        onClose={() => setConfirmClose(false)}
      >
        <p>{workDirty && !dirty.dirty ? `The changes to this ${kind.label.toLowerCase()} haven't been saved.` : "Some of your changes haven't been saved."}</p>
      </ConfirmDialog>
    </Dialog>
  );
}
