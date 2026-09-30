import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';

import { formatDuration, formatViews, joinMeta, srcSet, timeAgo } from '../lib/format.js';
import { SOURCE_LABELS, watchPath } from '../lib/sources.js';
import { whenIdle } from '../lib/useIdle.js';
import Icon, { SourceMark } from './Icon.jsx';
import SaveButton from './SaveButton.jsx';
import styles from './Billboard.module.scss';

const DELAY = 8000;

/**
 * The carousel engine (Embla, with its fade and autoplay plugins) loads once the browser is idle
 * after the first paint. Until then the first slide simply shows, as a still.
 */
const loadCarousel = () =>
  whenIdle().then(() => Promise.all([import('embla-carousel'), import('embla-carousel-autoplay'), import('embla-carousel-fade')]));

/**
 * The home page's featured videos: full-width slides that cross-fade every 8 seconds.
 *
 * Autoplay pauses while the pointer is over it or keyboard focus is inside it, when the tab is
 * hidden, and for good when the visitor presses pause (WCAG 2.2.2). With "reduce motion" it
 * doesn't start at all. Swipe, arrow buttons and the progress bars all move between slides.
 */
export default function Billboard({ videos, eyebrow = 'Trending' }) {
  const reduceMotion = useReducedMotion();
  const viewport = useRef(null);
  const [carousel, setCarousel] = useState(null);
  const embla = carousel?.embla;
  const [index, setIndex] = useState(0);
  // Slides are only built once they're shown or next to the one shown, so the page doesn't
  // download five large pictures up front (stacked slides all count as "in view" for lazy
  // loading) or lay out five slides before its first paint.
  const [ready, setReady] = useState(() => new Set([0, 1]));
  const [tick, setTick] = useState(0);
  const [timing, setTiming] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const shouldPlay = !paused && !hovered && !focused && !reduceMotion && videos.length > 1;

  useEffect(() => {
    let api;
    let cancelled = false;
    loadCarousel().then(([{ default: EmblaCarousel }, { default: Autoplay }, { default: Fade }]) => {
      if (cancelled || !viewport.current) return;
      // The plugin's own hover and focus handling would restart it even after the visitor pressed
      // pause, so it only times slides here; when to play is decided below.
      const autoplay = Autoplay({ delay: DELAY, playOnInit: false, stopOnInteraction: true, stopOnMouseEnter: false, stopOnFocusIn: false });
      api = EmblaCarousel(viewport.current, { loop: true, duration: 28 }, [Fade(), autoplay]);
      setCarousel({ embla: api, autoplay });
    });
    return () => {
      cancelled = true;
      api?.destroy();
    };
  }, []);

  const sync = useCallback(() => {
    if (!carousel) return;
    if (shouldPlay) carousel.autoplay.play();
    else carousel.autoplay.stop();
  }, [carousel, shouldPlay]);

  useEffect(sync, [sync]);

  useEffect(() => {
    if (!embla) return undefined;
    const onSelect = () => {
      const current = embla.selectedScrollSnap();
      setIndex(current);
      setReady((previous) => {
        const next = (current + 1) % videos.length;
        const before = (current - 1 + videos.length) % videos.length;
        if (previous.has(current) && previous.has(next) && previous.has(before)) return previous;
        return new Set([...previous, current, next, before]);
      });
    };
    const onTimerSet = () => {
      setTick((t) => t + 1);
      setTiming(true);
    };
    const onTimerStopped = () => setTiming(false);
    // A swipe stops the plugin; carry on afterwards if nothing else is pausing it.
    const onPointerUp = () => sync();
    embla
      .on('select', onSelect)
      .on('autoplay:timerset', onTimerSet)
      .on('autoplay:timerstopped', onTimerStopped)
      .on('pointerUp', onPointerUp);
    return () => {
      embla
        .off('select', onSelect)
        .off('autoplay:timerset', onTimerSet)
        .off('autoplay:timerstopped', onTimerStopped)
        .off('pointerUp', onPointerUp);
    };
  }, [embla, sync, videos.length]);

  const go = (target) => {
    embla?.scrollTo(target);
    sync();
  };

  return (
    <section
      className={`${styles.billboard} theme-dark`}
      aria-roledescription="carousel"
      aria-label="Featured videos"
      onPointerEnter={(event) => event.pointerType === 'mouse' && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setFocused(false)}
    >
      <div className={styles.viewport} ref={viewport}>
        <div className={styles.container}>
          {videos.map((video, i) => {
            // Slides that haven't been shown or aren't next up are empty frames for now.
            if (!ready.has(i)) return <div key={`${video.provider}:${video.id}`} className={styles.slide} aria-hidden="true" inert />;
            const active = i === index;
            const meta = joinMeta(video.channel?.title, formatViews(video.views), timeAgo(video.publishedAt), formatDuration(video.duration));
            const set = srcSet(video.thumbnails);
            return (
              <div
                key={`${video.provider}:${video.id}`}
                className={styles.slide}
                data-active={active}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${videos.length}`}
                aria-hidden={!active}
                inert={!active}
              >
                <div className={styles.media}>
                  <img
                    src={video.thumbnails?.at(-1)?.url ?? video.thumbnail}
                    srcSet={set || undefined}
                    sizes={set ? '100vw' : undefined}
                    alt=""
                    width="1280"
                    height="720"
                    fetchPriority={i === 0 ? 'high' : 'low'}
                    decoding="async"
                  />
                </div>
                <div className={styles.content}>
                  <p className={styles.eyebrow} style={{ '--i': 0 }}>
                    <SourceMark source={video.provider} size={16} />
                    <span>
                      <span className={styles.rank}>#{i + 1}</span> {eyebrow} on {SOURCE_LABELS[video.provider]}
                    </span>
                  </p>
                  <h2 className={styles.title} style={{ '--i': 1 }}>
                    {video.title}
                  </h2>
                  {meta && (
                    <p className={`${styles.meta} tabular`} style={{ '--i': 2 }}>
                      {meta}
                    </p>
                  )}
                  {video.description && (
                    <p className={styles.description} style={{ '--i': 3 }}>
                      {video.description}
                    </p>
                  )}
                  <div className={styles.actions} style={{ '--i': 4 }}>
                    <Link to={`${watchPath(video)}?play=1`} className={styles.play}>
                      <Icon name="play" size={20} />
                      Play
                      <span className="visually-hidden"> {video.title}</span>
                    </Link>
                    <Link to={watchPath(video)} className={styles.info}>
                      <Icon name="info" size={20} />
                      More info
                      <span className="visually-hidden"> about {video.title}</span>
                    </Link>
                    <SaveButton video={video} className={styles.save} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {videos.length > 1 && (
        <>
          <button
            type="button"
            className={`${styles.arrow} ${styles.prev}`}
            onClick={() => go(index - 1 < 0 ? videos.length - 1 : index - 1)}
            aria-label="Previous featured video"
          >
            <Icon name="chevronLeft" size={28} />
          </button>
          <button
            type="button"
            className={`${styles.arrow} ${styles.next}`}
            onClick={() => go((index + 1) % videos.length)}
            aria-label="Next featured video"
          >
            <Icon name="chevronRight" size={28} />
          </button>

          <div className={styles.controls}>
            <div className={styles.dots}>
              {videos.map((video, i) => (
                <button
                  key={`${video.provider}:${video.id}`}
                  type="button"
                  className={styles.dot}
                  aria-label={`Show featured video ${i + 1}: ${video.title}`}
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => go(i)}
                >
                  {i === index && (
                    <span key={tick} className={styles.fill} data-running={timing} style={{ animationDuration: `${DELAY}ms` }} />
                  )}
                </button>
              ))}
            </div>
            {!reduceMotion && (
              <button
                type="button"
                className={styles.pause}
                onClick={() => setPaused((value) => !value)}
                aria-label={paused ? 'Play the slideshow' : 'Pause the slideshow'}
                aria-pressed={paused}
              >
                <Icon name={paused ? 'play' : 'pause'} size={14} />
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** The billboard's shape while the feed loads, so the rows don't jump when it arrives. */
export function BillboardSkeleton() {
  return (
    <div className={`${styles.billboard} ${styles.skeleton} theme-dark`} aria-hidden="true">
      <div className={styles.content}>
        <span className={styles.bar} style={{ width: '14rem', height: '0.9rem' }} />
        <span className={styles.bar} style={{ width: 'min(36rem, 80%)', height: '3rem' }} />
        <span className={styles.bar} style={{ width: 'min(24rem, 60%)', height: '3rem' }} />
        <span className={styles.bar} style={{ width: '18rem', height: '1rem' }} />
      </div>
    </div>
  );
}
