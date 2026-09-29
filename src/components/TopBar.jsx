import { Link, NavLink } from 'react-router-dom';

import { LogoMark } from './Icon.jsx';
import SearchBox from './SearchBox.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import styles from './TopBar.module.scss';

export default function TopBar() {
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link to="/" className={styles.brand} aria-label="FundaStream home">
          <LogoMark />
          <span className={styles.wordmark}>FundaStream</span>
        </Link>

        <nav className={styles.nav} aria-label="Main">
          <NavLink to="/" end className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
            Home
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
            Library
          </NavLink>
        </nav>

        <div className={styles.search}>
          <SearchBox />
        </div>

        {/* Phones search from the bottom bar's Search page instead of squeezing a field in here. */}
        <div className={styles.actions}>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
