import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import Icon from './Icon.jsx';
import { CardSkeleton } from './Skeleton.jsx';
import VideoCard from './VideoCard.jsx';
import styles from './Row.module.scss';

/**
 * A titled row of videos that scrolls sideways, like a streaming app's shelves. Touch screens
 * swipe it (with snapping); pointers get paging arrows at the edges, which fade in on hover.
 * `ranked` numbers the cards (Top 10).
 */
export default function Row({ title, href, videos = [], loading = false, ranked = false }) {
  const scroller = useRef(null);
  const headingId = useId();
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [measure, videos.length, loading]);

  // One "page" is the visible width minus a card's peek, so the next page starts where you looked.
  const page = (direction) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: direction * (el.clientWidth * 0.86), behavior: 'smooth' });
  };

  if (!loading && videos.length === 0) return null;
  const List = ranked ? 'ol' : 'ul';

  return (
    <section className={`${styles.row} ${ranked ? styles.ranked : ''}`} aria-labelledby={headingId} aria-busy={loading || undefined}>
      <header className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          {title}
        </h2>
        {href && (
          <Link to={href} className={styles.more}>
            See all<span className="visually-hidden"> {title.toLowerCase()} videos</span>
            <Icon name="chevronRight" size={16} />
          </Link>
        )}
      </header>

      <div className={styles.frame} data-start={edges.start} data-end={edges.end}>
        <button type="button" className={`${styles.arrow} ${styles.prev}`} onClick={() => page(-1)} aria-label={`Scroll ${title} back`} hidden={edges.start}>
          <Icon name="chevronLeft" size={26} />
        </button>
        <List ref={scroller} className={styles.track}>
          {loading
            ? Array.from({ length: 6 }, (_, i) => (
                <li key={i} className={styles.item}>
                  <CardSkeleton />
                </li>
              ))
            : videos.map((video, i) => (
                <li key={`${video.provider}:${video.id}`} className={styles.item}>
                  {ranked && (
                    <span className={styles.rank} aria-hidden="true">
                      {i + 1}
                    </span>
                  )}
                  <VideoCard video={video} layout="shelf" index={i} />
                </li>
              ))}
        </List>
        <button type="button" className={`${styles.arrow} ${styles.next}`} onClick={() => page(1)} aria-label={`Scroll ${title} forward`} hidden={edges.end}>
          <Icon name="chevronRight" size={26} />
        </button>
      </div>
    </section>
  );
}
