import { useEffect, useId, useRef } from 'react';
import { m } from 'motion/react';

import Icon from './Icon.jsx';
import Toaster from './Toaster.jsx';
import styles from './Dialog.module.scss';

/**
 * A native modal <dialog> for forms: centred (`variant="modal"`), or a panel that slides in from
 * the side (`variant="drawer"`, a full-height sheet on phones). Focus stays inside and the page
 * behind can't be reached; Escape, the close button or a press outside call `onClose` (unless
 * `busy`). Focus goes back to whatever opened it, or to `returnFocus` when that ref is set (say,
 * once the thing that opened it is gone).
 */
export default function Dialog({ open, title, description, variant = 'modal', busy = false, onClose, children, footer, className = '', returnFocus }) {
  const dialog = useRef(null);
  const opener = useRef(null);
  const target = useRef(returnFocus);
  useEffect(() => {
    target.current = returnFocus;
  });
  const titleId = useId();
  const descriptionId = useId();
  const drawer = variant === 'drawer';

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement;
      element.showModal();
      // React's autoFocus ran while the dialog was still closed: a form starts in its first field,
      // a drawer on its title (so a screen reader announces where it is).
      const start = drawer ? element.querySelector('h2') : element.querySelector('input:not([type="hidden"]):not([type="file"]), textarea, select');
      start?.focus();
    } else if (!open && element.open) {
      element.close();
      const next = target.current?.current ?? opener.current;
      if (next?.isConnected) next.focus();
    }
  }, [open, drawer]);

  // Unmounting while open (closed by its parent, or navigating away) closes it too, so the page
  // isn't left inert, and focus goes back to what opened it.
  useEffect(() => {
    const element = dialog.current;
    const from = opener;
    const fallback = target;
    return () => {
      if (!element?.open) return;
      element.close();
      const next = fallback.current?.current ?? from.current;
      if (next?.isConnected) next.focus();
    };
  }, []);

  const cancel = () => !busy && onClose();

  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${styles[variant]}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onClick={(event) => event.target === dialog.current && cancel()}
    >
      {open && (
        <m.div
          className={`${styles.panel} ${className}`}
          initial={drawer ? { opacity: 0, x: 48 } : { opacity: 0, scale: 0.96, y: 8 }}
          animate={drawer ? { opacity: 1, x: 0 } : { opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        >
          <header className={styles.head}>
            <div className={styles.titles}>
              <h2 id={titleId} className={styles.title} tabIndex={-1}>
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className={styles.description}>
                  {description}
                </p>
              )}
            </div>
            <button type="button" className={styles.close} onClick={cancel} aria-label="Close">
              <Icon name="close" size={20} />
            </button>
          </header>
          <div className={styles.body}>{children}</div>
          {footer && <footer className={styles.foot}>{footer}</footer>}
        </m.div>
      )}
      {open && <Toaster inDialog drawer={drawer} />}
    </dialog>
  );
}
