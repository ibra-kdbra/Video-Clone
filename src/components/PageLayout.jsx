import { Sidebar } from './index';
import styles from './PageLayout.module.scss';

const PageLayout = ({ children }) => {
  return (
    <div className={styles.wrapper}>
      <div className={styles.sidebarSection}>
        <Sidebar />
      </div>
      <main className={styles.contentSection}>
        {children}
      </main>
    </div>
  );
};

export default PageLayout;
