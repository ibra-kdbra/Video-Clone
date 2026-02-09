import { Link } from 'react-router-dom';
import { logo, MenuIcon, UploadIcon, NotificationsIcon, UserIcon } from '../utils/constants';
import { SearchBar } from './index.js';
import styles from './Navbar.module.scss';

const Navbar = () => (
  <header className={styles.navbar}>
    <div className={styles.container}>
      {/* Left section removed as Logo is now in Sidebar */}
      
      <div className={styles.searchWrapper}>
        <SearchBar />
      </div>

      <div className={styles.actions}>

        <button className={styles.circleBtn}>
          <UploadIcon />
        </button>
        <button className={styles.circleBtn}>
          <NotificationsIcon />
        </button>
        <button className={`${styles.circleBtn} ${styles.avatarBtn}`}>
          <UserIcon />
        </button>
      </div>
    </div>
  </header>
);

export default Navbar;
