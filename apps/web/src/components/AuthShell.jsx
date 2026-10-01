import { useId } from 'react';
import { m } from 'motion/react';

import Backdrop from './Backdrop.jsx';
import { LogoMark } from './Icon.jsx';
import styles from './AuthShell.module.scss';

/**
 * A single card centered over the cinematic backdrop: sign-in, sign-up and invitations. The card
 * carries the page's one h1. `mark` replaces the logo (an invitation shows the school's emblem).
 */
export default function AuthShell({ title, lede, mark, tone, children, footer }) {
  const titleId = useId();
  return (
    <div className={styles.shell}>
      <Backdrop tone={tone} />
      <m.section
        className={styles.card}
        aria-labelledby={titleId}
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
      >
        <div className={styles.mark}>{mark ?? <LogoMark size={44} />}</div>
        <h1 id={titleId} className={styles.title}>
          {title}
        </h1>
        {lede && <p className={styles.lede}>{lede}</p>}
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </m.section>
    </div>
  );
}
