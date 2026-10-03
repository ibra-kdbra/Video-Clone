import { lazy, Suspense } from 'react';
import { m } from 'motion/react';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { mainLinks } from '../lib/home.js';
import { authPath } from '../lib/paths.js';
import { searchPath, searchSchoolFor } from '../lib/searchRoute.js';
import { useSession } from '../lib/useSession.js';
import AccountMenu from './AccountMenu.jsx';
import { LogoMark } from './Icon.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import Icon from './Icon.jsx';
import styles from './TopBar.module.scss';

// Only people signed in have notifications, so the bell (and its live updates) is its own chunk.
const NotificationBell = lazy(() => import('./NotificationBell.jsx'));
// The same goes for searching their school.
const SchoolSearchBox = lazy(() => import('./SchoolSearchBox.jsx'));

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

/** The top bar: the LMS's sections, the school search, the notifications bell and the account. */
export default function TopBar() {
  const { pathname } = useLocation();
  const { status, schools } = useSession();
  // Signed-in members search their school (the page's, or their first); the results page has its
  // own field, so the bar's steps aside there.
  const searchIn = status === 'signedIn' ? searchSchoolFor(pathname, schools) : null;
  const onResults = /^\/s\/[^/]+\/search\/?$/.test(pathname);
  // Home alone (signed out, or in no school yet) is what the logo already does, so it gets no nav.
  const links = mainLinks(schools, pathname);

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link to="/" className={styles.brand} aria-label="Grand LMS home">
          <LogoMark />
          <span className={styles.wordmark}>Grand LMS</span>
        </Link>

        {links.length > 1 && (
          <nav className={styles.nav} aria-label="Main">
            {links.map((link) => (
              <NavLink key={link.label} to={link.to} end className={styles.navLink} aria-current={link.active ? 'page' : undefined}>
                {link.active && <m.span layoutId="nav-pill" className={styles.pill} aria-hidden="true" />}
                <span className={styles.navLabel}>{link.label}</span>
              </NavLink>
            ))}
          </nav>
        )}

        {searchIn && !onResults && (
          <div className={styles.search}>
            <Suspense fallback={<span className={styles.searchSpace} aria-hidden="true" />}>
              <SchoolSearchBox key={searchIn.slug} school={searchIn} />
            </Suspense>
          </div>
        )}

        <div className={styles.actions}>
          {searchIn && !onResults && (
            <Link to={searchPath(searchIn.slug)} className={styles.searchButton} aria-label={`Search ${searchIn.name}`} title={`Search ${searchIn.name}`}>
              <Icon name="search" />
            </Link>
          )}
          <ThemeToggle />
          <SessionControl />
        </div>
      </div>
    </header>
  );
}
