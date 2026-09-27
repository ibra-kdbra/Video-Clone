import { memo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  demoChannelTitle,
  demoThumbnailUrl,
  demoVideoTitle,
  BookmarkIcon,
  YouTubeIcon,
  TwitchIcon,
  DailymotionIcon,
} from '../utils/constants';
import { formatCount, formatDuration, thumbnailSrcSet } from '../utils/format';
import { useWatchLater } from '../hooks/useWatchLater';
import styles from './VideoCard.module.scss';

const platformIcons = {
  youtube: YouTubeIcon,
  twitch: TwitchIcon,
  dailymotion: DailymotionIcon,
};

/** Card widths in the grid (4 → 3 → 2 → 1 across), so the browser picks the right thumbnail. */
const SIZES = '(min-width: 1400px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw';

/** Everything the card shows, from either a normalized multi-provider item or a raw YouTube one. */
function readVideo(video) {
  if (video?.provider) {
    return {
      id: video.id,
      provider: video.provider,
      title: video.title,
      thumbnail: video.thumbnail || demoThumbnailUrl,
      srcSet: thumbnailSrcSet(video.thumbnails),
      channelTitle: video.channelTitle,
      channelId: video.channelId,
      publishedAt: video.publishedAt,
      viewCount: video.viewCount,
      duration: video.duration,
    };
  }
  const snippet = video?.snippet ?? {};
  return {
    id: typeof video?.id === 'object' ? video.id?.videoId : video?.id,
    provider: 'youtube',
    title: snippet.title || demoVideoTitle,
    thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || demoThumbnailUrl,
    srcSet: thumbnailSrcSet(snippet.thumbnails),
    channelTitle: snippet.channelTitle || demoChannelTitle,
    channelId: snippet.channelId,
    publishedAt: snippet.publishedAt,
    viewCount: video?.statistics?.viewCount,
    duration: formatDuration(video?.contentDetails?.duration),
  };
}

const VideoCard = ({ video, layout, titleAs = 'h3' }) => {
  const Title = titleAs;
  const { toggleWatchLater, isInWatchLater } = useWatchLater();
  const [toast, setToast] = useState(null);

  const v = readVideo(video);
  const isYouTube = v.provider === 'youtube';
  const saved = isInWatchLater(v.id);
  const views = formatCount(v.viewCount);
  const publishedDate = v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : null;
  // YouTube videos open in the app; Twitch and Dailymotion open on their own sites.
  const href = isYouTube ? `/video/${v.id}` : video?.playerUrl;
  const PlatformIcon = platformIcons[v.provider];

  const handleBookmark = (event) => {
    event.preventDefault();
    event.stopPropagation();
    // YouTube items are stored raw (the History and Watch Later pages read that shape); the
    // others keep their normalized form so they still render there.
    const storable = video?.provider === 'youtube' ? (video._raw ?? video) : video;
    const added = toggleWatchLater(storable);
    setToast(added ? 'Added to Watch Later' : 'Removed from Watch Later');
    setTimeout(() => setToast(null), 2000);
  };

  const linkProps = { className: styles.thumbnailWrapper };
  const thumbnail = (
    <>
      <img
        src={v.thumbnail}
        srcSet={v.srcSet || undefined}
        sizes={v.srcSet ? SIZES : undefined}
        alt=""
        width="480"
        height="270"
        loading="lazy"
        decoding="async"
      />
      {v.duration && <span className={styles.timestamp}>{v.duration}</span>}
      {!isYouTube && PlatformIcon && (
        <span className={`${styles.platformBadge} ${styles[v.provider]}`}>
          <PlatformIcon />
        </span>
      )}
      <button
        type="button"
        className={`${styles.bookmarkBtn} ${saved ? styles.bookmarked : ''}`}
        onClick={handleBookmark}
        aria-label={saved ? 'Remove from Watch Later' : 'Save to Watch Later'}
        title={saved ? 'Remove from Watch Later' : 'Save to Watch Later'}
      >
        <BookmarkIcon filled={saved} />
      </button>
    </>
  );
  const heading = <Title className={styles.title}>{v.title}</Title>;

  return (
    <article className={`${styles.card} ${layout === 'column' ? styles.rowLayout : ''}`}>
      {isYouTube ? (
        <Link to={href} {...linkProps} aria-label={v.title}>
          {thumbnail}
        </Link>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer" {...linkProps} aria-label={v.title}>
          {thumbnail}
        </a>
      )}

      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}

      <div className={styles.content}>
        <div className={styles.avatar} aria-hidden="true">
          {v.channelTitle?.charAt(0) || 'V'}
        </div>

        <div className={styles.details}>
          {isYouTube ? (
            <Link to={href}>{heading}</Link>
          ) : (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {heading}
            </a>
          )}

          {isYouTube && v.channelId ? (
            <Link to={`/channel/${v.channelId}`} className={styles.channelName}>
              {v.channelTitle}
            </Link>
          ) : (
            <span className={styles.channelName}>{v.channelTitle}</span>
          )}

          <div className={styles.metadata}>
            {[views && `${views} views`, publishedDate].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
    </article>
  );
};

export default memo(VideoCard);
