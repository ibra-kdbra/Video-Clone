import { m } from 'motion/react';
import { NavLink, useLocation } from 'react-router-dom';

import { authPath } from '../lib/paths.js';
import { useSession } from '../lib/useSession.js';
import Icon from './Icon.jsx';
import styles from './BottomNav.module.scss';

const ITEMS = [
  { to: '/', label: 'Home', icon: 'home', exact: true },
  { to: '/browse/trending', label: 'Browse', icon: 'compass', match: ['/browse'] },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/library', label: 'Library', icon: 'library' },
];

/**
 * Phones: the main sections within thumb's reach. The last tab is the person's account and
 * schools when signed in, and "Sign in" (coming back to this page) when not.
 */
export default function BottomNav() {
  const { pathname, search } = useLocation();
  const { status } = useSession();
  const account =
    status === 'signedIn'
      ? { to: '/account', label: 'Account', icon: 'user', match: ['/account', '/s/', '/schools'] }
      : { to: authPath('signin', `${pathname}${search}`), label: 'Sign in', icon: 'user', match: ['/signin', '/signup'] };

  return (
    <nav className={styles.nav} aria-label="Main">
      {[...ITEMS, account].map((item) => {
        const active = item.exact ? pathname === item.to : (item.match ?? [item.to]).some((prefix) => pathname.startsWith(prefix));
        return (
          <NavLink key={item.label} to={item.to} className={styles.item} aria-current={active ? 'page' : undefined}>
            {active && <m.span layoutId="tab-indicator" className={styles.indicator} aria-hidden="true" />}
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
