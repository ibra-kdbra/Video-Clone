import { lazy, Suspense } from 'react';
import { m } from 'motion/react';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { authPath } from '../lib/paths.js';
import { useScrolled } from '../lib/useScrolled.js';
import { useSession } from '../lib/useSession.js';
import AccountMenu from './AccountMenu.jsx';
import { LogoMark } from './Icon.jsx';
import SearchBox from './SearchBox.jsx';
import SourcePicker from './SourcePicker.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import styles from './TopBar.module.scss';

// Only people signed in have notifications, so the bell (and its live updates) is its own chunk.
const NotificationBell = lazy(() => import('./NotificationBell.jsx'));

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/browse/trending', label: 'Browse', match: '/browse' },
  { to: '/library', label: 'Library' },
];

/** Signed in: the notifications bell and the profile menu. Signed out: "Sign in", which comes back to this page after. */
function SessionControl() {
  const { status } = useSession();
  const { pathname, search } = useLocation();
  if (status === 'loading') return <span className={styles.pending} aria-hidden="true" />;
  if (status === 'signedIn')
    return (
      <>
        <Suspense fallback={<span className={styles.bellSpace} aria-hidden="true" />}>
          <NotificationBell />
        </Suspense>
        <AccountMenu />
      </>
    );
  if (pathname === '/signin' || pathname === '/signup') return null;
  return (
    <Link to={authPath('signin', `${pathname}${search}`)} className={styles.signIn}>
      Sign in
    </Link>
  );
}

/**
 * The top bar. On the home page it floats, see-through, over the billboard until the page
 * scrolls, then settles into a solid, blurred bar.
 */
export default function TopBar() {
  const { pathname } = useLocation();
  const scrolled = useScrolled(24);
  const floating = pathname === '/' && !scrolled;

  return (
    <header className={`${styles.bar} ${floating ? `${styles.floating} theme-dark` : ''}`}>
      <div className={styles.inner}>
        <Link to="/" className={styles.brand} aria-label="Grand LMS home">
          <LogoMark />
          <span className={styles.wordmark}>Grand LMS</span>
        </Link>

        <nav className={styles.nav} aria-label="Main">
          {LINKS.map((link) => {
            const active = link.match ? pathname.startsWith(link.match) : link.end ? pathname === link.to : pathname.startsWith(link.to);
            return (
              <NavLink key={link.to} to={link.to} end={link.end} className={styles.navLink} aria-current={active ? 'page' : undefined}>
                {active && <m.span layoutId="nav-pill" className={styles.pill} aria-hidden="true" />}
                <span className={styles.navLabel}>{link.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className={styles.search}>
          <SearchBox />
        </div>

        <div className={styles.actions}>
          <SourcePicker compact />
          <ThemeToggle />
          <SessionControl />
        </div>
      </div>
    </header>
  );
}
