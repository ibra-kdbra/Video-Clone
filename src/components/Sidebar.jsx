import { memo, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { categories, logo, MenuIcon, YouTubeIcon, TwitchIcon, DailymotionIcon } from '../utils/constants';
import { useUI } from '../context/UIContext';
import { PROVIDERS, PROVIDER_LABELS } from '../services/providers/types.js';
import styles from './Sidebar.module.scss';

const platformIcons = {
  [PROVIDERS.YOUTUBE]: YouTubeIcon,
  [PROVIDERS.TWITCH]: TwitchIcon,
  [PROVIDERS.DAILYMOTION]: DailymotionIcon,
};

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    selectedCategory,
    setCategory,
    sidebarOpen,
    toggleSidebar,
    activeProviders,
    toggleProvider,
    mobileNavOpen,
    closeMobileNav,
  } = useUI();

  // On phones the sidebar is a drawer: it closes on navigation and on Escape.
  useEffect(() => {
    closeMobileNav();
  }, [location.pathname, closeMobileNav]);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const onKey = (event) => event.key === 'Escape' && closeMobileNav();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileNavOpen, closeMobileNav]);

  const handleCategoryClick = (name) => {
    if (name === 'History') {
      navigate('/history');
    } else if (name === 'Watch Later') {
      navigate('/watch-later');
    } else {
      if (location.pathname !== '/') {
        navigate('/');
      }
      setCategory(name);
    }
    closeMobileNav();
  };

  return (
    <>
    {mobileNavOpen && <div className={styles.backdrop} onClick={closeMobileNav} aria-hidden="true" />}
    <aside
      id="app-sidebar"
      className={`${styles.sidebar} ${!sidebarOpen && !mobileNavOpen ? styles.collapsed : ''} ${mobileNavOpen ? styles.mobileOpen : ''}`}
    >
      <div className={styles.header}>
        <button
          type="button"
          className={styles.menuBtn}
          onClick={mobileNavOpen ? closeMobileNav : toggleSidebar}
          aria-label={mobileNavOpen ? 'Close menu' : sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <MenuIcon />
        </button>
        <Link to="/" className={styles.logo}>
          <div className={styles.logoIcon}>
            {logo}
          </div>
          <span className={styles.brand}>FundaStream</span>
        </Link>
      </div>

      <nav className={styles.navList}>

        {categories.map((category) => {
          const isSelected = category.name === 'History' 
            ? location.pathname === '/history'
            : category.name === 'Watch Later'
            ? location.pathname === '/watch-later'
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

      <div className={styles.platforms}>
        <p className={styles.sectionTitle} id="platforms-title">Platforms</p>
        {Object.values(PROVIDERS).map((providerId) => {
          const Icon = platformIcons[providerId];
          const isActive = activeProviders.includes(providerId);
          return (
            <button
              key={providerId}
              className={`${styles.platformItem} ${isActive ? styles.active : ''}`}
              onClick={() => toggleProvider(providerId)}
              aria-pressed={isActive}
              title={`${isActive ? 'Disable' : 'Enable'} ${PROVIDER_LABELS[providerId]}`}
            >
              <span className={styles.icon}>
                {Icon && <Icon />}
              </span>
              <span className={styles.label}>{PROVIDER_LABELS[providerId]}</span>
              <span className={`${styles.toggle} ${isActive ? styles.on : ''}`}>
                <span className={styles.toggleDot} />
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.footer}>
        <p className={styles.copyright}>
          © 2026 FundaStream Inc.<br />
          Built with React 19 & Sass
        </p>
      </div>
    </aside>
    </>
  );
};

export default memo(Sidebar);
