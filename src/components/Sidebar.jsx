import { memo } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { categories, logo, MenuIcon } from '../utils/constants';
import { useUI } from '../context/UIContext';
import styles from './Sidebar.module.scss';

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedCategory, setCategory, sidebarOpen, toggleSidebar } = useUI();

  const handleCategoryClick = (name) => {
    if (name === 'History') {
      navigate('/history');
    } else {
      if (location.pathname !== '/') {
        navigate('/');
      }
      setCategory(name);
    }
  };

  return (
    <aside className={`${styles.sidebar} ${!sidebarOpen ? styles.collapsed : ''}`}>
      <div className={styles.header}>
        <button className={styles.menuBtn} onClick={toggleSidebar}>
          <MenuIcon />
        </button>
        <Link to="/" className={styles.logo}>
          <div className={styles.logoIcon}>
            {logo}
          </div>
          <div className={styles.brand}>
            <h1>FundaStream</h1>
          </div>
        </Link>
      </div>

      <nav className={styles.navList}>

        {categories.map((category) => {
          const isSelected = category.name === 'History' 
            ? location.pathname === '/history'
            : (category.name === selectedCategory && location.pathname === '/');
          
          const Icon = category.icon;
          
          return (
            <button
              key={category.name}
              className={`${styles.navItem} ${isSelected ? styles.active : ''}`}
              onClick={() => handleCategoryClick(category.name)}
            >
              <span className={styles.icon}>
                {Icon && <Icon fontSize="medium" />}
              </span>
              <span className={styles.label}>{category.name}</span>
            </button>
          );
        })}
      </nav>

      <div className={styles.footer}>
        <p className={styles.copyright}>
          © 2026 FundaStream Inc.<br />
          Built with React 19 & Sass
        </p>
      </div>
    </aside>
  );
};

export default memo(Sidebar);
