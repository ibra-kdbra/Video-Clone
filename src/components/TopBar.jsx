import { m } from 'motion/react';
import { Link, NavLink, useLocation } from 'react-router-dom';

import { useScrolled } from '../lib/useScrolled.js';
import { LogoMark } from './Icon.jsx';
import SearchBox from './SearchBox.jsx';
import SourcePicker from './SourcePicker.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import styles from './TopBar.module.scss';

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/browse/trending', label: 'Browse', match: '/browse' },
  { to: '/library', label: 'Library' },
];

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
        <Link to="/" className={styles.brand} aria-label="FundaStream home">
          <LogoMark />
          <span className={styles.wordmark}>FundaStream</span>
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
        </div>
      </div>
    </header>
  );
}
