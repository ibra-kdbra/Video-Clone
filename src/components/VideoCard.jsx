import { memo } from 'react';
import { Link } from 'react-router-dom';

import { formatViews, joinMeta, timeAgo } from '../lib/format.js';
import { watchPath } from '../lib/sources.js';
import SaveButton from './SaveButton.jsx';
import Thumbnail from './Thumbnail.jsx';
import styles from './VideoCard.module.scss';

/** How wide a grid card's thumbnail is shown (4 → 3 → 2 → 1 across), for the srcset. */
const GRID_SIZES = '(min-width: 1600px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw';
const ROW_SIZES = '(min-width: 768px) 240px, 40vw';

/**
 * A video in a grid ("grid") or a list ("row"). The whole card is one link target for the
 * video; the channel name and Save button are separate controls on top of it.
 */
function VideoCard({ video, layout = 'grid', titleAs: Title = 'h3', priority = false, extra }) {
  const href = watchPath(video);
  const meta = joinMeta(formatViews(video.views), timeAgo(video.publishedAt));
  const channelLink = video.provider === 'youtube' && video.channel?.id;

  return (
    <article className={`${styles.card} ${styles[layout]}`}>
      <div className={styles.media}>
        <Thumbnail video={video} sizes={layout === 'row' ? ROW_SIZES : GRID_SIZES} priority={priority} />
        <SaveButton video={video} className={styles.save} />
      </div>
      <div className={styles.body}>
        <Title className={styles.title}>
          {/* The stretched link makes the whole card clickable while keeping one tab stop. */}
          <Link to={href} className={styles.link}>
            {video.title}
          </Link>
        </Title>
        {video.channel?.title &&
          (channelLink ? (
            <Link to={`/channel/${video.channel.id}`} className={styles.channel}>
              {video.channel.title}
            </Link>
          ) : (
            <span className={styles.channel}>{video.channel.title}</span>
          ))}
        {meta && <p className={`${styles.meta} tabular`}>{meta}</p>}
        {extra}
      </div>
    </article>
  );
}

export default memo(VideoCard);
