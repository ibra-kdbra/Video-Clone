import { useId, useState } from 'react';
import { REPORT_REASONS, reportPostInput } from '@grand/contracts';

import { REPORT_REASON_LABELS } from '../lib/discussions.js';
import { issuesByField } from '../lib/forms.js';
import Button from './Button.jsx';
import Dialog from './Dialog.jsx';
import { TextAreaField } from './Field.jsx';
import Icon from './Icon.jsx';
import styles from './Discussion.module.scss';

const HINTS = {
  spam: 'Advertising, or the same thing posted again and again.',
  abuse: 'Insults, threats or harassment.',
  off_topic: 'Nothing to do with this course.',
  other: 'Tell the moderators what’s wrong in the note.',
};

/**
 * Reporting a post to the course's moderators: a reason, and a note if they want. A post can be
 * reported once per person. `onSubmit(input)` sends it and resolves true once it's done.
 */
export default function ReportDialog({ open, onClose, onSubmit, busy }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const groupId = useId();

  const close = () => {
    onClose();
    setErrors({});
  };

  const submit = async (event) => {
    event.preventDefault();
    const result = reportPostInput.safeParse({ reason, note });
    const found = issuesByField(result);
    if (found.reason) found.reason = 'Choose a reason';
    setErrors(found);
    if (!result.success) {
      document.getElementById(found.reason ? `${groupId}-${REPORT_REASONS[0]}` : `${groupId}-note`)?.focus();
      return;
    }
    if (await onSubmit(result.data)) {
      setReason('');
      setNote('');
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      title="Report this post"
      description="The course's moderators will see your report. The author won't know who sent it."
      busy={busy}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="danger" icon="flag" type="submit" form={`${groupId}-form`} busy={busy}>
            Report
          </Button>
        </>
      }
    >
      <form id={`${groupId}-form`} className={styles.reportForm} onSubmit={submit} noValidate>
        <fieldset className={styles.reasons} aria-describedby={errors.reason ? `${groupId}-error` : undefined}>
          <legend className={styles.legend}>What’s wrong with it?</legend>
          {REPORT_REASONS.map((value) => (
            <label key={value} className={styles.reason} htmlFor={`${groupId}-${value}`}>
              <input
                id={`${groupId}-${value}`}
                type="radio"
                name="reason"
                value={value}
                checked={reason === value}
                onChange={() => {
                  setReason(value);
                  setErrors((current) => ({ ...current, reason: undefined }));
                }}
              />
              <span className={styles.reasonText}>
                <span className={styles.reasonLabel}>{REPORT_REASON_LABELS[value]}</span>
                <span className={styles.reasonHint}>{HINTS[value]}</span>
              </span>
            </label>
          ))}
          {errors.reason && (
            <p id={`${groupId}-error`} className={styles.fieldError}>
              <Icon name="alert" size={15} />
              {errors.reason}
            </p>
          )}
        </fieldset>
        <TextAreaField
          id={`${groupId}-note`}
          label="Note for the moderators (optional)"
          value={note}
          maxLength={500}
          rows={3}
          error={errors.note}
          onChange={(event) => setNote(event.target.value)}
        />
      </form>
    </Dialog>
  );
}
