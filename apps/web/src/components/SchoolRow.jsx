import { useId } from 'react';
import { Link } from 'react-router-dom';

import { toneFor } from '../lib/tone.js';
import Icon from './Icon.jsx';
import Monogram from './Monogram.jsx';
import RoleBadge from './RoleBadge.jsx';
import styles from './SchoolRow.module.scss';

/**
 * "Your schools" on the home page, above the videos: one tile per school (in its own colors) and a
 * tile for creating one. Phones swipe through them; wider screens lay them out in a grid.
 */
export default function SchoolRow({ schools, loading }) {
  const headingId = useId();
  return (
    <section className={styles.row} aria-labelledby={headingId} aria-busy={loading || undefined}>
      <header className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          Your schools
        </h2>
        <Link to="/account" className={styles.more}>
          Manage<span className="visually-hidden"> your schools</span>
          <Icon name="chevronRight" size={16} />
        </Link>
      </header>

      <ul className={styles.track}>
        {loading
          ? Array.from({ length: 2 }, (_, i) => <li key={i} className={`${styles.item} ${styles.placeholder}`} aria-hidden="true" />)
          : schools.map((school, i) => (
              <li key={school.id} className={styles.item} style={{ '--i': i }}>
                <Link to={`/s/${school.slug}`} className={styles.tile} data-tone={toneFor(school.slug)}>
                  <Monogram name={school.name} seed={school.slug} size={52} className={styles.mark} />
                  <span className={styles.text}>
                    <span className={styles.name}>{school.name}</span>
                    <RoleBadge role={school.role} glass />
                  </span>
                </Link>
              </li>
            ))}
        {!loading && (
          <li className={styles.item} style={{ '--i': schools.length }}>
            <Link to="/schools/new" className={`${styles.tile} ${styles.create}`}>
              <span className={styles.plus}>
                <Icon name="plus" size={24} />
              </span>
              <span className={styles.text}>
                <span className={styles.name}>Create a school</span>
                <span className={styles.hint}>{schools.length ? 'Start another one' : 'Invite your instructors and students'}</span>
              </span>
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
