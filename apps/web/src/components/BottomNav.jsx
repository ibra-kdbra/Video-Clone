import { m } from 'motion/react';
import { NavLink, useLocation } from 'react-router-dom';

import { mainLinks } from '../lib/home.js';
import { authPath } from '../lib/paths.js';
import { useSession } from '../lib/useSession.js';
import Icon from './Icon.jsx';
import styles from './BottomNav.module.scss';

/**
 * Phones: the main sections within thumb's reach, as in the top bar (home, and the person's school
 * when signed in). The last tab is the person's account when signed in, and "Sign in" (coming back
 * to this page) when not.
 */
export default function BottomNav() {
  const { pathname, search } = useLocation();
  const { status, schools } = useSession();
  const account =
    status === 'signedIn'
      ? { to: '/account', label: 'Account', icon: 'user', active: ['/account', '/schools', '/notifications'].some((prefix) => pathname.startsWith(prefix)) }
      : { to: authPath('signin', `${pathname}${search}`), label: 'Sign in', icon: 'user', active: ['/signin', '/signup'].some((prefix) => pathname.startsWith(prefix)) };
  const items = [...mainLinks(status === 'signedIn' ? schools : [], pathname), account];

  return (
    <nav className={styles.nav} aria-label="Main" style={{ '--items': items.length }}>
      {items.map((item) => (
        <NavLink key={item.label} to={item.to} end className={styles.item} aria-current={item.active ? 'page' : undefined}>
          {item.active && <m.span layoutId="tab-indicator" className={styles.indicator} aria-hidden="true" />}
          <Icon name={item.icon} size={22} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
