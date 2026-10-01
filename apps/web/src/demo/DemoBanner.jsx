import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Icon from '../components/Icon.jsx';
import { getSession, signOut } from '../lib/session.js';
import { toast } from '../lib/toast.js';
import { resetDemo } from './server.js';
import styles from './DemoBanner.module.scss';

const COLLAPSED = 'grand.demo.banner';

function readCollapsed() {
  try {
    return sessionStorage.getItem(COLLAPSED) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed) {
  try {
    if (collapsed) sessionStorage.setItem(COLLAPSED, '1');
    else sessionStorage.removeItem(COLLAPSED);
  } catch {
    // Storage blocked: it stays as chosen until the next page load.
  }
}

/**
 * The slim note under the top bar in the demo: what this is, that changes stay in this browser,
 * and "Reset demo", which puts the demo school back as it started (and signs out). It can be
 * folded away for the rest of the visit, but always comes back on the next one. Its height is
 * shared as --demo-banner-h, so the Explore billboard can still start at the very top.
 */
export default function DemoBanner() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef(null);
  const textId = useId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const element = root.current;
    const html = document.documentElement;
    const measure = () => html.style.setProperty('--demo-banner-h', `${element.offsetHeight}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      html.style.removeProperty('--demo-banner-h');
    };
  }, []);

  const toggle = (next) => {
    setCollapsed(next);
    writeCollapsed(next);
  };

  const reset = async () => {
    setBusy(true);
    resetDemo();
    if (getSession().status !== 'signedOut') await signOut();
    setBusy(false);
    setConfirming(false);
    navigate('/');
    await queryClient.invalidateQueries();
    toast('The demo is back to how it started');
  };

  return (
    <aside ref={root} className={`${styles.banner} ${collapsed ? styles.collapsed : ''}`} aria-label="About this demo">
      {collapsed ? (
        <div className={styles.inner}>
          <button type="button" className={styles.pill} aria-expanded="false" onClick={() => toggle(false)}>
            <Icon name="info" size={14} />
            Demo
            <span className="visually-hidden">: show the note about this demo</span>
          </button>
        </div>
      ) : (
        <div className={styles.inner}>
          <Icon name="info" size={18} className={styles.icon} />
          <p id={textId} className={styles.text}>
            <strong>Demo school with sample data.</strong> Changes are saved only in this browser.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.reset} onClick={() => setConfirming(true)}>
              <Icon name="refresh" size={15} />
              Reset demo
            </button>
            <button
              type="button"
              className={styles.fold}
              aria-expanded="true"
              aria-controls={textId}
              aria-label="Hide this note for now"
              title="Hide this note for now"
              onClick={() => toggle(true)}
            >
              <Icon name="chevronUp" size={18} />
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog open={confirming} title="Reset the demo?" confirmLabel="Reset demo" busy={busy} onConfirm={reset} onClose={() => setConfirming(false)}>
        <p>Everything you changed in the demo school (enrollments, progress, work handed in, accounts you created) goes back to how it started, and you'll be signed out.</p>
      </ConfirmDialog>
    </aside>
  );
}
