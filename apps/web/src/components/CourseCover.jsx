import { useState } from 'react';

import { toneFor } from '../lib/tone.js';
import styles from './CourseCover.module.scss';

/**
 * A course's 16:9 artwork: its cover image (a still from its first video) when it has one, or else
 * key art drawn from its title in the course's own colors, picked from its address so it looks the
 * same everywhere. Decorative: the title is always written next to it. `backdrop` is the hero's
 * version, with no title and softer shapes; `thumb` is a small one, also without a title. A cover
 * link expires after a while; if the image fails, the drawn art takes its place.
 */
export default function CourseCover({ course, variant = 'card', priority = false, className = '' }) {
  const [failed, setFailed] = useState(false);
  const image = course.coverUrl && !failed;

  return (
    <div className={`${styles.cover} ${styles[variant]} ${image ? '' : styles.drawn} ${className}`} data-tone={toneFor(course.slug)} aria-hidden="true">
      {image ? (
        <img
          src={course.coverUrl}
          alt=""
          width="1280"
          height="720"
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <span className={styles.orb} />
          <span className={styles.rings} />
          {variant === 'card' && <span className={styles.title}>{course.title}</span>}
        </>
      )}
    </div>
  );
}
