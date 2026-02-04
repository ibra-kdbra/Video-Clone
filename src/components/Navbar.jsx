import { Link } from 'react-router-dom';
import { logo } from '../utils/constants';
import { SearchBar } from './index.js';
import styles from './Navbar.module.scss';

const Navbar = () => (
  <header className={styles.navbar}>
    <div className={styles.container}>
      <Link to="/" className={styles.logo}>
        <img src={logo} alt="FundaStream" />
        <div className={styles.brand}>
          <h1>FundaStream</h1>
          <span>Premium streaming</span>
        </div>
      </Link>

      <div className={styles.searchWrapper}>
        <SearchBar />
      </div>

      <div className={styles.actions}>
        {/* Future actions like Upload, User Avatar */}
      </div>
    </div>
  </header>
);

export default Navbar;
