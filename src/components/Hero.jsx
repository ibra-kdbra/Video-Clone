import { Link } from 'react-router-dom';

import { demoThumbnailUrl } from '../utils/constants';
import { thumbnailSrcSet } from '../utils/format';
import styles from './Hero.module.scss';

const FALLBACK_SUBTITLE = 'Discover what people are watching right now, across YouTube, Twitch and Dailymotion.';

/** The featured video at the top of the feed. */
const Hero = ({ video }) => {
  if (!video) return null;

  // Supports both normalized (multi-provider) and raw YouTube video shapes.
  const isNormalized = Boolean(video.provider);
  const provider = isNormalized ? video.provider : 'youtube';
  const id = isNormalized ? video.id : typeof video.id === 'object' ? video.id?.videoId : video.id;
  const thumbnails = isNormalized ? video.thumbnails : video.snippet?.thumbnails;
  const image = (isNormalized ? video.thumbnail : thumbnails?.high?.url) || demoThumbnailUrl;
  const title = (isNormalized ? video.title : video.snippet?.title) || 'Discover something new';
  const subtitle = (isNormalized ? video.description : video.snippet?.description) || FALLBACK_SUBTITLE;
  const srcSet = thumbnailSrcSet(thumbnails);

  return (
    <div className={styles.heroContainer}>
      <div className={styles.heroCard}>
        <img
          src={image}
          srcSet={srcSet || undefined}
          sizes={srcSet ? '(min-width: 1024px) 60vw, 100vw' : undefined}
          alt=""
          className={styles.bgImage}
          fetchPriority="high"
        />

        <div className={styles.content}>
          <h1 title={title}>{title}</h1>
          <p>{subtitle}</p>
          {provider === 'youtube' ? (
            <Link to={`/video/${id}`} className={styles.actionBtn}>
              Start watching
            </Link>
          ) : (
            <a href={video.playerUrl} target="_blank" rel="noopener noreferrer" className={styles.actionBtn}>
              Watch on {provider === 'twitch' ? 'Twitch' : 'Dailymotion'}
            </a>
          )}
        </div>

        <div className={styles.floatingBadge}>Featured</div>
      </div>
    </div>
  );
};

export default Hero;
