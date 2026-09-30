import { Link } from 'react-router-dom';

import { EmptyState } from '../components/States.jsx';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import styles from './NotFound.module.scss';

export default function NotFound({ title = 'Page not found', children = "The link may be broken, or the page may have moved." }) {
  useDocumentTitle(title);
  return (
    <div className="page">
      <EmptyState
        icon="alert"
        title={title}
        titleAs="h1"
        action={
          <Link to="/" className={styles.home}>
            Go to the home page
          </Link>
        }
      >
        {children}
      </EmptyState>
    </div>
  );
}
