import { memo } from 'react';
import { Link } from 'react-router-dom';

import { formatViews, joinMeta, timeAgo } from '../lib/format.js';
import { watchPath } from '../lib/sources.js';
import Icon from './Icon.jsx';
import SaveButton from './SaveButton.jsx';
import Thumbnail from './Thumbnail.jsx';
import styles from './VideoCard.module.scss';

/**
 * How wide a card's thumbnail is shown, so the browser picks the right file from the srcset:
 * grids go 4 → 3 → 2 → 1 across; rows show about 6 → 5 → 4 → 3 → 2 cards.
 */
const SIZES = {
  grid: '(min-width: 1600px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw',
  shelf: '(min-width: 1600px) 17vw, (min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 32vw, (min-width: 640px) 45vw, 85vw',
  row: '(min-width: 768px) 240px, 40vw',
  result: '(min-width: 640px) 380px, 100vw',
};

/**
 * A video in a grid, a row of cards ("shelf"), a list ("row") or search results ("result"). The
 * whole card is one link to the video; the channel name and Save button are separate controls
 * on top of it. `index` staggers the cards' entrance.
 */
function VideoCard({ video, layout = 'grid', titleAs: Title = 'h3', priority = false, extra, index = 0 }) {
  const href = watchPath(video);
  const meta = joinMeta(formatViews(video.views), timeAgo(video.publishedAt));
  const channelLink = video.provider === 'youtube' && video.channel?.id;

  return (
    <article className={`${styles.card} ${styles[layout === 'shelf' ? 'grid' : layout]}`} style={{ '--i': Math.min(index, 12) }}>
      <div className={styles.media}>
        <Thumbnail video={video} sizes={SIZES[layout] ?? SIZES.grid} priority={priority} />
        <span className={styles.playHint} aria-hidden="true">
          <Icon name="play" size={22} />
        </span>
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
