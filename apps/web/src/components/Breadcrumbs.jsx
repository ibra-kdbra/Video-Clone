import { Link } from 'react-router-dom';

import Icon from './Icon.jsx';
import styles from './Breadcrumbs.module.scss';

/**
 * Where a page sits: school › course › lesson. The last item is the page itself. On phones only the
 * level above shows, as a back link, so the trail never wraps onto several lines.
 */
export default function Breadcrumbs({ items, className = '' }) {
  return (
    <nav aria-label="Breadcrumb" className={`${styles.trail} ${className}`}>
      <ol>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${item.label}`} className={i === items.length - 2 ? styles.parent : undefined}>
              {last ? (
                <span aria-current="page" className={styles.current}>
                  {item.label}
                </span>
              ) : (
                <>
                  <Link to={item.to} className={styles.link}>
                    <Icon name="arrowLeft" size={16} className={styles.back} />
                    <span>{item.label}</span>
                  </Link>
                  <Icon name="chevronRight" size={14} className={styles.separator} />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
