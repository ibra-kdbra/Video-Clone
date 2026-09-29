import { NavLink } from 'react-router-dom';

import Icon from './Icon.jsx';
import styles from './BottomNav.module.scss';

const ITEMS = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/library', label: 'Library', icon: 'library' },
];

/** Phones: the main sections within thumb's reach. */
export default function BottomNav() {
  return (
    <nav className={styles.nav} aria-label="Main">
      {ITEMS.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''}`}>
          <Icon name={item.icon} size={22} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
