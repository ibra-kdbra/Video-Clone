import { m } from 'motion/react';
import { NavLink, useLocation } from 'react-router-dom';

import Icon from './Icon.jsx';
import styles from './BottomNav.module.scss';

const ITEMS = [
  { to: '/', label: 'Home', icon: 'home', exact: true },
  { to: '/browse/trending', label: 'Browse', icon: 'compass', match: '/browse' },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/library', label: 'Library', icon: 'library' },
];

/** Phones: the main sections within thumb's reach. */
export default function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className={styles.nav} aria-label="Main">
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.to : pathname.startsWith(item.match ?? item.to);
        return (
          <NavLink key={item.to} to={item.to} className={styles.item} aria-current={active ? 'page' : undefined}>
            {active && <m.span layoutId="tab-indicator" className={styles.indicator} aria-hidden="true" />}
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
