import { memo } from 'react';
import { Link } from 'react-router-dom';

import { coursePath } from '../lib/courses.js';
import { formatRuntime, joinMeta, plural } from '../lib/format.js';
import Badge from './Badge.jsx';
import CourseCover from './CourseCover.jsx';
import Icon from './Icon.jsx';
import ProgressBar from './ProgressBar.jsx';
import styles from './CourseCard.module.scss';

const STATUS = { draft: { label: 'Draft', tone: 'warning', icon: 'edit' }, archived: { label: 'Archived', tone: 'neutral', icon: 'archive' } };

/** "Start the first lesson", "3 of 8 lessons done", "Completed". */
function progressLine(progress) {
  if (!progress || (progress.completedLessons === 0 && !progress.lastLessonId)) return 'Start the first lesson';
  if (progress.totalLessons > 0 && progress.completedLessons >= progress.totalLessons) return 'Completed';
  return `${progress.completedLessons} of ${plural(progress.totalLessons, 'lesson')} done`;
}

/**
 * A course in the catalog, in the streaming style of the video cards: artwork that lifts on hover
 * with a play hint, the title, a line of summary, and how much there is to watch. Drafts and
 * archived courses say so on the artwork; enrolled ones get a check. The whole card is one link.
 * `showProgress` turns it into a "Continue" card: how far along this person is, with a bar along
 * the artwork's foot, as streaming apps do.
 */
function CourseCard({ course, schoolSlug, showProgress = false, index = 0, titleAs: Title = 'h3', priority = false }) {
  const status = STATUS[course.status];
  const meta = joinMeta(plural(course.lessonCount, 'lesson'), formatRuntime(course.durationSeconds));
  const progress = showProgress ? course.progress : null;

  return (
    <article className={`${styles.card} ${showProgress ? styles.continue : ''}`} style={{ '--i': Math.min(index, 12) }}>
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
        {progress && progress.percent > 0 && <ProgressBar value={progress.percent} tone={progress.percent >= 100 ? 'success' : 'accent'} className={styles.progress} />}
      </div>
      <div className={styles.body}>
        <Title className={styles.title}>
          {/* The stretched link makes the whole card clickable while keeping one tab stop. */}
          <Link to={coursePath(schoolSlug, course.slug)} className={styles.link}>
            {course.title}
          </Link>
        </Title>
        {showProgress ? (
          <p className={`${styles.resume} tabular`}>
            <Icon name={progress && progress.percent >= 100 ? 'checkCircle' : 'play'} size={12} />
            <span>{progressLine(progress)}</span>
            {progress && progress.percent > 0 && progress.percent < 100 && <span className={styles.percent}>{progress.percent}%</span>}
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
