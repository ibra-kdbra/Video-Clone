import { memo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  demoChannelTitle,
  demoChannelUrl,
  demoThumbnailUrl,
  demoVideoTitle,
  demoVideoUrl,
  BookmarkIcon,
  YouTubeIcon,
  TwitchIcon,
  DailymotionIcon,
} from '../utils/constants';
import { useWatchLater } from '../hooks/useWatchLater';
import styles from './VideoCard.module.scss';

const platformIcons = {
  youtube: YouTubeIcon,
  twitch: TwitchIcon,
  dailymotion: DailymotionIcon,
};

const VideoCard = ({ video, layout }) => {
  const { toggleWatchLater, isInWatchLater } = useWatchLater();
  const [toast, setToast] = useState(null);

  // Detect whether this is a normalized multi-provider item or a raw YouTube item
  const isNormalized = Boolean(video?.provider);

  const videoId = isNormalized
    ? video.id
    : (typeof video?.id === 'object' ? video.id?.videoId : video?.id);

  const snippet = video?.snippet ?? {};

  const title = isNormalized ? video.title : (snippet.title || demoVideoTitle);
  const thumbnail = isNormalized
    ? video.thumbnail
    : (snippet.thumbnails?.high?.url || demoThumbnailUrl);
  const channelTitle = isNormalized
    ? video.channelTitle
    : (snippet.channelTitle || demoChannelTitle);
  const channelId = isNormalized ? video.channelId : snippet.channelId;
  const publishedAt = isNormalized ? video.publishedAt : snippet.publishedAt;
  const provider = isNormalized ? video.provider : 'youtube';
  const duration = isNormalized ? video.duration : null;

  const saved = isInWatchLater(videoId);

  const publishedDate = publishedAt
    ? new Date(publishedAt).toLocaleDateString()
    : null;

  const videoLink = provider === 'youtube'
    ? (videoId ? `/video/${videoId}` : demoVideoUrl)
    : (video?.playerUrl ?? demoVideoUrl);

  const isExternal = provider !== 'youtube';
  const PlatformIcon = platformIcons[provider];

  const handleBookmark = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Store normalized version for all providers
    const storableVideo = isNormalized
      ? video._raw ?? video
      : video;
    const added = toggleWatchLater(storableVideo);
    setToast(added ? 'Added to Watch Later' : 'Removed from Watch Later');
    setTimeout(() => setToast(null), 2000);
  };

  const LinkOrAnchor = isExternal
    ? ({ children, to, className: cls }) => (
        <a href={to} target="_blank" rel="noopener noreferrer" className={cls}>{children}</a>
      )
    : Link;

  return (
    <article className={`${styles.card} ${layout === 'column' ? styles.rowLayout : ''}`}>
      <LinkOrAnchor to={videoLink} className={styles.thumbnailWrapper}>
        <img
          src={thumbnail}
          alt={title}
          loading="lazy"
        />
        {duration && <span className={styles.timestamp}>{duration}</span>}
        {!duration && <span className={styles.timestamp}>12:45</span>}
        {provider !== 'youtube' && PlatformIcon && (
          <span className={`${styles.platformBadge} ${styles[provider]}`}>
            <PlatformIcon />
          </span>
        )}
        <button
          className={`${styles.bookmarkBtn} ${saved ? styles.bookmarked : ''}`}
          onClick={handleBookmark}
          title={saved ? 'Remove from Watch Later' : 'Save to Watch Later'}
        >
          <BookmarkIcon filled={saved} />
        </button>
      </LinkOrAnchor>

      {toast && <div className={styles.toast}>{toast}</div>}

      <div className={styles.content}>
        <div className={styles.avatar}>
          {channelTitle?.charAt(0) || 'V'}
        </div>
        
        <div className={styles.details}>
          <LinkOrAnchor to={videoLink}>
            <h3 className={styles.title}>{title}</h3>
          </LinkOrAnchor>

          <Link to={channelId ? `/channel/${channelId}` : demoChannelUrl} className={styles.channelName}>
            {channelTitle}
            {provider === 'youtube' && (
              <span className={styles.verifiedBadge}>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM10 17l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
              </span>
            )}
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
