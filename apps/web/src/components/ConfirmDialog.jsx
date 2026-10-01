import { useEffect, useId, useRef, useState } from 'react';
import { m } from 'motion/react';

import Button from './Button.jsx';
import { TextField } from './Field.jsx';
import styles from './ConfirmDialog.module.scss';

/**
 * Asks before something that can't be undone (removing a member, leaving a school). It's a native
 * modal <dialog>: focus stays inside, Escape cancels and the page behind can't be reached. Focus
 * starts on the safe choice. Afterwards it goes to `returnFocus` when that ref is set (say, once
 * the thing that opened the dialog is gone), or else back to whatever opened it. For the gravest
 * actions (deleting a course), `confirmText` asks for that text to be typed first. `tone="primary"`
 * is for a step that's final but not destructive (handing in work).
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onClose,
  returnFocus,
  confirmText,
  tone = 'danger',
}) {
  const dialog = useRef(null);
  const opener = useRef(null);
  const target = useRef(returnFocus);
  const titleId = useId();
  const textId = useId();
  const [typed, setTyped] = useState('');
  const matches = !confirmText || typed.trim() === confirmText.trim();

  useEffect(() => {
    target.current = returnFocus;
  });

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement;
      setTyped('');
      element.showModal();
    } else if (!open && element.open) {
      // Closing makes the page reachable again, so only now can focus move back into it.
      element.close();
      const next = target.current?.current ?? opener.current;
      if (next?.isConnected) next.focus();
    }
  }, [open]);

  const cancel = () => !busy && onClose();

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={textId}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      // A press on the dimmed area around the panel (the dialog element itself) cancels.
      onClick={(event) => event.target === dialog.current && cancel()}
    >
      {open && (
        <m.div className={styles.panel} initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <div id={textId} className={styles.text}>
            {children}
          </div>
          {confirmText && (
            <TextField
              className={styles.typed}
              label={
                <>
                  Type <strong>{confirmText}</strong> to confirm
                </>
              }
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && matches && !busy && onConfirm()}
              autoComplete="off"
              spellCheck="false"
            />
          )}
          <div className={styles.actions}>
            <Button variant="ghost" onClick={cancel} autoFocus>
              {cancelLabel}
            </Button>
            <Button variant={tone === 'primary' ? 'primary' : 'danger'} busy={busy} disabled={!matches} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </m.div>
      )}
    </dialog>
  );
}
