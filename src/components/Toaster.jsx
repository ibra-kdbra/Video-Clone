import { AnimatePresence, m } from 'motion/react';

import { useToast } from '../lib/toast.js';
import Icon from './Icon.jsx';
import styles from './Toaster.module.scss';

export default function Toaster() {
  const current = useToast();
  return (
    <div className={styles.region} role="status" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {current && (
          <m.div
            key={current.id}
            className={styles.toast}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15 } }}
          >
            <span className={styles.check}>
              <Icon name="check" size={14} />
            </span>
            {current.message}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
