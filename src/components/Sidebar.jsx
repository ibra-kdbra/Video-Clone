import { memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { categories } from '../utils/constants';
import styles from './Sidebar.module.scss';

const Sidebar = ({ selectedCategory, setSelectedCategory }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleCategoryClick = (name) => {
    if (name === 'History') {
      navigate('/history');
    } else {
      if (location.pathname !== '/') {
        navigate('/');
      }
      setSelectedCategory(name);
    }
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <h3>Explore</h3>
        <p>Curated categories</p>
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
