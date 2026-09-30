import { useEffect, useId, useRef } from 'react';
import { m } from 'motion/react';

import Button from './Button.jsx';
import styles from './ConfirmDialog.module.scss';

/**
 * Asks before something that can't be undone (removing a member, leaving a school). It's a native
 * modal <dialog>: focus stays inside, Escape cancels and the page behind can't be reached. Focus
 * starts on the safe choice. Afterwards it goes to `returnFocus` when that ref is set (say, once
 * the thing that opened the dialog is gone), or else back to whatever opened it.
 */
export default function ConfirmDialog({ open, title, children, confirmLabel, busy = false, onConfirm, onClose, returnFocus }) {
  const dialog = useRef(null);
  const opener = useRef(null);
  const target = useRef(returnFocus);
  const titleId = useId();
  const textId = useId();

  useEffect(() => {
    target.current = returnFocus;
  });

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement;
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
          <div className={styles.actions}>
            <Button variant="ghost" onClick={cancel} autoFocus>
              Cancel
            </Button>
            <Button variant="danger" busy={busy} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </m.div>
      )}
    </dialog>
  );
}
