import { Link } from 'react-router-dom';

import { formatViews, joinMeta, srcSet, timeAgo } from '../lib/format.js';
import { SOURCE_LABELS, watchPath } from '../lib/sources.js';
import Icon, { SourceMark } from './Icon.jsx';
import SaveButton from './SaveButton.jsx';
import { Block } from './Skeleton.jsx';
import styles from './Spotlight.module.scss';

/** The featured video at the top of the home page. */
export default function Spotlight({ video, eyebrow }) {
  const set = srcSet(video.thumbnails);
  const meta = joinMeta(video.channel?.title, formatViews(video.views), timeAgo(video.publishedAt));

  return (
    <section className={styles.spotlight} aria-labelledby="spotlight-title">
      <div className={styles.media}>
        {video.thumbnail && (
          <img
            src={video.thumbnail}
            srcSet={set || undefined}
            sizes={set ? '(min-width: 768px) 70vw, 100vw' : undefined}
            alt=""
            width="1280"
            height="720"
            fetchPriority="high"
            decoding="async"
          />
        )}
      </div>
      <div className={styles.content}>
        <p className={styles.eyebrow}>
          <SourceMark source={video.provider} size={16} />
          {eyebrow} on {SOURCE_LABELS[video.provider]}
        </p>
        <h2 id="spotlight-title" className={styles.title}>
          <Link to={watchPath(video)}>{video.title}</Link>
        </h2>
        {meta && <p className={`${styles.meta} tabular`}>{meta}</p>}
        {video.description && <p className={styles.description}>{video.description}</p>}
        <div className={styles.actions}>
          <Link to={watchPath(video)} className={styles.play}>
            <Icon name="play" size={18} />
            Play
          </Link>
          <SaveButton video={video} variant="pill" />
        </div>
      </div>
    </section>
  );
}

/** Same shape as the spotlight (eyebrow, two title lines, meta, buttons), so nothing jumps. */
export function SpotlightSkeleton() {
  const titleLine = 'calc(var(--text-3xl) * 1.2)';
  return (
    <div className={styles.spotlight} aria-hidden="true">
      <div className={`${styles.media} ${styles.loading}`} />
      <div className={styles.content}>
        <Block width="35%" height="1.125rem" />
        <Block width="90%" height={titleLine} />
        <Block width="60%" height={titleLine} />
        <Block width="45%" height="1.25rem" />
        <div className={styles.actions}>
          <Block width="96px" height="40px" radius="var(--radius-pill)" />
          <Block width="92px" height="40px" radius="var(--radius-pill)" />
        </div>
      </div>
    </div>
  );
}
