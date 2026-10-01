import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assignmentInput } from '@grand/contracts';

import { fromDateTimeLocal, toDateTimeLocal } from '../lib/assignments.js';
import { keys } from '../lib/courses.js';
import { detailsByField, errorMessage, issuesByField } from '../lib/forms.js';
import { configureAssignment, getAssignment } from '../lib/learning.js';
import { toast } from '../lib/toast.js';
import Button from './Button.jsx';
import { FormAlert, TextField } from './Field.jsx';
import Icon from './Icon.jsx';
import { Block } from './Skeleton.jsx';
import { ErrorState } from './States.jsx';
import styles from './AssignmentSettings.module.scss';

const valuesOf = (assignment) => ({
  maxPoints: String(assignment.maxPoints),
  allowText: assignment.allowText,
  allowFiles: assignment.allowFiles,
  dueAt: toDateTimeLocal(assignment.dueAt),
});

const toInput = (values) => ({
  maxPoints: values.maxPoints.trim() === '' ? Number.NaN : Number(values.maxPoints),
  allowText: values.allowText,
  allowFiles: values.allowFiles,
  dueAt: fromDateTimeLocal(values.dueAt),
});

const FRIENDLY = { maxPoints: 'Use a whole number from 1 to 1000', dueAt: 'Pick a date and time, or leave it empty' };

/** A checkbox with its label and a line of explanation. */
function Option({ label, hint, checked, onChange, describedBy }) {
  const id = useId();
  return (
    <div className={styles.option}>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-describedby={[`${id}-hint`, describedBy].filter(Boolean).join(' ')} />
      <div className={styles.optionText}>
        <label htmlFor={id} className={styles.optionLabel}>
          {label}
        </label>
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      </div>
    </div>
  );
}

function SettingsForm({ assignment, onSave, onDirtyChange }) {
  const [saved, setSaved] = useState(() => valuesOf(assignment));
  const [values, setValues] = useState(saved);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const kindsError = useId();
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const set = (patch) => {
    const next = { ...values, ...patch };
    setValues(next);
    if (Object.keys(errors).length) setErrors(friendly(issuesByField(assignmentInput.safeParse(toInput(next)))));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !dirty) return;
    const result = assignmentInput.safeParse(toInput(values));
    if (!result.success) {
      setErrors(friendly(issuesByField(result)));
      return;
    }
    setBusy(true);
    try {
      const next = valuesOf(await onSave(result.data));
      setSaved(next);
      setValues(next);
      setErrors({});
      toast('Assignment settings saved');
    } catch (error) {
      const found = friendly(detailsByField(error));
      setErrors(Object.keys(found).length ? found : { '': errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <FormAlert>{errors['']}</FormAlert>
      <div className={styles.row}>
        <TextField
          label="Points"
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          step={1}
          value={values.maxPoints}
          error={errors.maxPoints}
          hint="What the work is graded out of."
          onChange={(event) => set({ maxPoints: event.target.value })}
          className={styles.points}
        />
        <div className={styles.due}>
          <TextField
            label="Due date"
            type="datetime-local"
            value={values.dueAt}
            error={errors.dueAt}
            hint="In your time zone. Leave it empty for no due date."
            onChange={(event) => set({ dueAt: event.target.value })}
            trailing={
              values.dueAt ? (
                <button type="button" className={styles.clear} onClick={() => set({ dueAt: '' })} aria-label="Clear the due date" title="Clear the due date">
                  <Icon name="close" size={16} />
                </button>
              ) : null
            }
          />
        </div>
      </div>
      <fieldset className={styles.kinds}>
        <legend className={styles.legend}>Students hand in</legend>
        <Option
          label="A written answer"
          hint="They write it here; it's saved as they type."
          checked={values.allowText}
          onChange={(on) => set({ allowText: on })}
          describedBy={errors.allowText ? kindsError : undefined}
        />
        <Option
          label="Files"
          hint="Up to 5 files of 25 MB each: documents, images, archives, audio or MP4."
          checked={values.allowFiles}
          onChange={(on) => set({ allowFiles: on })}
          describedBy={errors.allowText ? kindsError : undefined}
        />
        {errors.allowText && (
          <p id={kindsError} className={styles.error}>
            <Icon name="alert" size={15} />
            {errors.allowText}
          </p>
        )}
      </fieldset>
      <div className={styles.actions}>
        <Button type="submit" variant="primary" busy={busy} disabled={!dirty}>
          Save settings
        </Button>
        <p className={styles.hint} aria-live="polite">
          {dirty ? 'Unsaved changes' : ''}
        </p>
      </div>
    </form>
  );
}

/** zod's wording for the number and date fields, said plainly; the rest as the API puts it. */
function friendly(found) {
  return Object.fromEntries(Object.entries(found).map(([field, message]) => [field, FRIENDLY[field] ?? message]));
}

/**
 * An assignment's settings, in its lesson drawer: what it's graded out of, whether students write
 * an answer, hand in files, or both, and when it's due.
 */
export default function AssignmentSettings({ school, course, lessonId, onDirtyChange }) {
  const queryClient = useQueryClient();
  const slug = school.slug;
  const key = keys.assignment(slug, course.slug, lessonId);
  const assignment = useQuery({ queryKey: key, queryFn: ({ signal }) => getAssignment(slug, course.slug, lessonId, signal), staleTime: 30_000 });

  if (assignment.isError) return <ErrorState title="Couldn't load the assignment" error={assignment.error} onRetry={() => assignment.refetch()} />;
  if (assignment.isPending) return <Block height="12rem" radius="var(--radius-md)" />;

  const save = async (input) => {
    const saved = await configureAssignment(slug, course.slug, lessonId, input);
    queryClient.setQueryData(key, saved);
    queryClient.invalidateQueries({ queryKey: keys.insights(slug, course.slug) });
    return saved;
  };

  return <SettingsForm assignment={assignment.data} onSave={save} onDirtyChange={onDirtyChange} />;
}
