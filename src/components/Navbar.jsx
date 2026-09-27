import { Link } from 'react-router-dom';

import { logo, MenuIcon } from '../utils/constants';
import { useUI } from '../context/UIContext';
import SearchBar from './SearchBar';
import styles from './Navbar.module.scss';

const Navbar = () => {
  const { mobileNavOpen, openMobileNav } = useUI();

  return (
    <header className={styles.navbar}>
      <div className={styles.container}>
        {/* Phones only: the sidebar is hidden there, so the menu opens it as a drawer. */}
        <div className={styles.mobileStart}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={openMobileNav}
            aria-label="Open menu"
            aria-expanded={mobileNavOpen}
            aria-controls="app-sidebar"
          >
            <MenuIcon />
          </button>
          <Link to="/" className={styles.mobileLogo} aria-label="FundaStream home">
            {logo}
          </Link>
        </div>

        <div className={styles.searchWrapper}>
          <SearchBar />
        </div>
      </div>
    </header>
  );
};

export default Navbar;
