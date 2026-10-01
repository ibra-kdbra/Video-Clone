import { useState } from 'react';

import { formatDuration, srcSet } from '../lib/format.js';
import { SOURCE_LABELS } from '../lib/sources.js';
import { SourceMark } from './Icon.jsx';
import styles from './Thumbnail.module.scss';

/**
 * A 16:9 video image with its duration and platform. `sizes` tells the browser how wide it is
 * shown, so it downloads the right file from the srcset.
 */
export default function Thumbnail({ video, sizes, priority = false, showSource = true }) {
  const [failed, setFailed] = useState(false);
  const set = srcSet(video.thumbnails);
  const duration = formatDuration(video.duration);

  return (
    <div className={styles.frame}>
      {video.thumbnail && !failed ? (
        <img
          src={video.thumbnail}
          srcSet={set || undefined}
          sizes={set ? sizes : undefined}
          alt=""
          width="640"
          height="360"
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles.placeholder} aria-hidden="true">
          <SourceMark source={video.provider} size={28} />
        </span>
      )}
      {video.live ? (
        <span className={`${styles.badge} ${styles.live}`}>Live</span>
      ) : (
        duration && <span className={`${styles.badge} tabular`}>{duration}</span>
      )}
      {showSource && (
        <span className={styles.source} title={SOURCE_LABELS[video.provider]}>
          <SourceMark source={video.provider} size={14} />
          <span className="visually-hidden">{SOURCE_LABELS[video.provider]}</span>
        </span>
      )}
    </div>
  );
}
