import { AnimatePresence, m } from 'motion/react';

import { useToast } from '../lib/toast.js';
import Icon from './Icon.jsx';
import styles from './Toaster.module.scss';

const ICONS = { success: 'check', info: 'info', error: 'alert' };

/**
 * The toast on screen. A new one waits for the old one to leave ("wait"): Motion's "popLayout"
 * would add a <style> element for the leaving one, which the CSP (style-src 'self') refuses.
 * `inDialog` is the copy a modal dialog carries: while one is open, the page behind it is inert
 * (unseen, and silent to screen readers), so the dialog shows and announces toasts itself.
 */
export default function Toaster({ inDialog = false, drawer = false }) {
  const current = useToast();
  return (
    <div className={`${styles.region} ${inDialog ? styles.inDialog : styles.page} ${drawer ? styles.inDrawer : ''}`} role="status" aria-live="polite">
      <AnimatePresence mode="wait">
        {current && (
          <m.div
            key={current.id}
            className={styles.toast}
            data-tone={current.tone}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
          >
            <span className={styles.check}>
              <Icon name={ICONS[current.tone] ?? 'check'} size={14} />
            </span>
            {current.message}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
