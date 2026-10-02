import { useEffect, useId, useRef, useState } from 'react';
import { newPostInput } from '@grand/contracts';

import { issuesByField } from '../lib/forms.js';
import Button from './Button.jsx';
import { TextAreaField } from './Field.jsx';
import styles from './Discussion.module.scss';

/**
 * Writing a comment or a reply: a text box and a button. Ctrl+Enter (⌘+Enter) sends too. The text
 * is checked as the API checks it, and stays put if sending fails. `onSubmit(body)` resolves
 * true once it's posted, which empties the box.
 */
export default function PostComposer({ label, placeholder, submitLabel = 'Post', onSubmit, onCancel, busy = false, autoFocus = false, hint, compact = false }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(!compact || autoFocus);
  const field = useRef(null);
  const formId = useId();

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  const submit = async (event) => {
    event?.preventDefault();
    if (busy) return;
    const result = newPostInput.safeParse({ body });
    if (!result.success) {
      setError(issuesByField(result).body);
      field.current?.focus();
      return;
    }
    setError(null);
    const sent = body;
    if (await onSubmit(result.data.body)) {
      // Empty again, unless something new was typed while it was being sent.
      setBody((current) => (current === sent ? '' : current));
      if (compact && !onCancel) setOpen(false);
    }
  };

  return (
    <form id={formId} className={`${styles.composer} ${compact && !open ? styles.composerFolded : ''}`} onSubmit={submit} noValidate>
      <TextAreaField
        ref={field}
        label={label}
        hideLabel
        placeholder={placeholder}
        value={body}
        rows={open ? 3 : 1}
        error={error}
        hint={open ? hint : undefined}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setBody(event.target.value);
          if (error && event.target.value.trim()) setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit(event);
          if (event.key === 'Escape' && onCancel && !body.trim()) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {open && (
        <div className={styles.composerActions}>
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button size="sm" variant="primary" type="submit" icon="send" busy={busy}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
