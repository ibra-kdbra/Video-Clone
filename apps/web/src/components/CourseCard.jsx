import { memo } from 'react';
import { Link } from 'react-router-dom';

import { coursePath } from '../lib/courses.js';
import { formatRuntime, joinMeta, plural } from '../lib/format.js';
import Badge from './Badge.jsx';
import CourseCover from './CourseCover.jsx';
import Icon from './Icon.jsx';
import styles from './CourseCard.module.scss';

const STATUS = { draft: { label: 'Draft', tone: 'warning', icon: 'edit' }, archived: { label: 'Archived', tone: 'neutral', icon: 'archive' } };

/**
 * A course in the catalog, in the streaming style of the video cards: artwork that lifts on hover
 * with a play hint, the title, a line of summary, and how much there is to watch. Drafts and
 * archived courses say so on the artwork; enrolled ones get a check. The whole card is one link.
 * `resume` (the last lesson opened) turns it into a "Continue" card.
 */
function CourseCard({ course, schoolSlug, resume, index = 0, titleAs: Title = 'h3', priority = false }) {
  const status = STATUS[course.status];
  const meta = joinMeta(plural(course.lessonCount, 'lesson'), formatRuntime(course.durationSeconds));

  return (
    <article className={`${styles.card} ${resume !== undefined ? styles.continue : ''}`} style={{ '--i': Math.min(index, 12) }}>
      <div className={styles.media}>
        <CourseCover course={course} priority={priority} />
        <span className={styles.playHint} aria-hidden="true">
          <Icon name="play" size={22} />
        </span>
        <span className={styles.badges}>
          {status && (
            <Badge tone={status.tone} icon={status.icon} glass>
              {status.label}
            </Badge>
          )}
        </span>
        {course.enrolled && (
          <span className={styles.enrolled} title="You're enrolled">
            <Icon name="check" size={14} />
            <span className="visually-hidden">Enrolled</span>
          </span>
        )}
      </div>
      <div className={styles.body}>
        <Title className={styles.title}>
          {/* The stretched link makes the whole card clickable while keeping one tab stop. */}
          <Link to={coursePath(schoolSlug, course.slug)} className={styles.link}>
            {course.title}
          </Link>
        </Title>
        {resume !== undefined ? (
          <p className={styles.resume}>
            <Icon name="play" size={12} />
            <span>{resume ? `Continue: ${resume.title}` : 'Start the first lesson'}</span>
          </p>
        ) : (
          course.summary && <p className={styles.summary}>{course.summary}</p>
        )}
        <p className={`${styles.meta} tabular`}>{meta}</p>
      </div>
    </article>
  );
}

export default memo(CourseCard);

/** A card's shape while the catalog loads. */
export function CourseCardSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <span className={styles.skeletonMedia} />
      <span className={styles.skeletonLine} />
      <span className={`${styles.skeletonLine} ${styles.short}`} />
    </div>
  );
}
