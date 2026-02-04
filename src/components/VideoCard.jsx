import { memo } from 'react';
import { Link } from 'react-router-dom';

import {
  demoChannelTitle,
  demoChannelUrl,
  demoThumbnailUrl,
  demoVideoTitle,
  demoVideoUrl,
} from '../utils/constants';
import styles from './VideoCard.module.scss';

const VideoCard = ({ video, layout }) => {
  const { id, snippet = {} } = video || {};
  
  // Handle different API response formats: 
  // /search returns { id: { videoId } }
  // /videos returns { id: "videoId" }
  const videoId = typeof id === 'object' ? id?.videoId : id;
  
  const publishedDate = snippet?.publishedAt
    ? new Date(snippet.publishedAt).toLocaleDateString()
    : null;

  return (
    <article className={`${styles.card} ${layout === 'column' ? styles.rowLayout : ''}`}>
      <Link to={videoId ? `/video/${videoId}` : demoVideoUrl} className={styles.thumbnailWrapper}>
        <img
          src={snippet?.thumbnails?.high?.url || demoThumbnailUrl}
          alt={snippet?.title}
          loading="lazy"
        />
        <span className={styles.timestamp}>12:45</span>
      </Link>

      <div className={styles.content}>
        <div className={styles.avatar}>
          {snippet?.channelTitle?.charAt(0) || 'V'}
        </div>
        
        <div className={styles.details}>
          <Link to={videoId ? `/video/${videoId}` : demoVideoUrl}>
            <h3 className={styles.title}>{snippet?.title || demoVideoTitle}</h3>
          </Link>

          <Link to={snippet?.channelId ? `/channel/${snippet?.channelId}` : demoChannelUrl} className={styles.channelName}>
            {snippet?.channelTitle || demoChannelTitle}
            <span className={styles.verifiedBadge}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM10 17l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
            </span>
          </Link>

          <div className={styles.metadata}>
            <span>{publishedDate || 'Just now'}</span>
          </div>
        </div>
      </div>
    </article>
  );
};

export default memo(VideoCard);
