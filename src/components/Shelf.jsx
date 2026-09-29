import { useRef } from 'react';
import { Link } from 'react-router-dom';

import Icon from './Icon.jsx';
import VideoCard from './VideoCard.jsx';
import styles from './Shelf.module.scss';

/** A titled, horizontally scrolling row of videos (e.g. "Continue watching"). */
export default function Shelf({ title, videos, moreHref, moreLabel = 'See all' }) {
  const scroller = useRef(null);
  const headingId = `shelf-${title.toLowerCase().replace(/\W+/g, '-')}`;
  const scrollBy = (direction) => scroller.current?.scrollBy({ left: direction * scroller.current.clientWidth * 0.8, behavior: 'smooth' });

  return (
    <section className={styles.shelf} aria-labelledby={headingId}>
      <header className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          {title}
        </h2>
        {moreHref && (
          <Link to={moreHref} className={styles.more}>
            {moreLabel}
          </Link>
        )}
        <div className={styles.arrows}>
          <button type="button" onClick={() => scrollBy(-1)} aria-label={`Scroll ${title} left`}>
            <Icon name="chevronLeft" size={18} />
          </button>
          <button type="button" onClick={() => scrollBy(1)} aria-label={`Scroll ${title} right`}>
            <Icon name="chevronRight" size={18} />
          </button>
        </div>
      </header>
      <div ref={scroller} className={styles.scroller}>
        {videos.map((video) => (
          <div key={`${video.provider}:${video.id}`} className={styles.item}>
            <VideoCard video={video} />
          </div>
        ))}
      </div>
    </section>
  );
}
