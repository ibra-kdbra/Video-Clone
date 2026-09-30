import { useEffect, useRef, useState } from 'react';
import { m } from 'motion/react';
import { Link } from 'react-router-dom';

import { CATEGORIES } from '../lib/categories.js';
import Icon from './Icon.jsx';
import styles from './ChipBar.module.scss';

/** The categories as a scrollable row of chips; the highlight slides to the chosen one. */
export default function ChipBar({ active, sticky = true }) {
  const scroller = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const update = () => setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  // Keep the chosen chip in view (e.g. after opening a shared link to a category). This sets
  // scrollLeft rather than calling scrollIntoView, which would also move the browser's Tab
  // starting point to the chip, so keyboard users would skip the skip link and the top bar.
  useEffect(() => {
    const el = scroller.current;
    const chip = el?.querySelector('[aria-current="page"]');
    if (!chip) return;
    const { offsetLeft, offsetWidth } = chip;
    if (offsetLeft < el.scrollLeft || offsetLeft + offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = offsetLeft - 16;
  }, [active]);

  const scrollBy = (direction) => scroller.current?.scrollBy({ left: direction * scroller.current.clientWidth * 0.7, behavior: 'smooth' });

  return (
    <div className={`${styles.bar} ${sticky ? styles.sticky : ''}`}>
      <div className={styles.track}>
        {!edges.start && (
          <button type="button" className={`${styles.arrow} ${styles.left}`} onClick={() => scrollBy(-1)} aria-label="Scroll categories left" tabIndex={-1}>
            <Icon name="chevronLeft" size={18} />
          </button>
        )}
        <nav ref={scroller} className={styles.chips} aria-label="Categories">
          {CATEGORIES.map((category) => {
            const current = category.slug === active;
            return (
              <Link key={category.slug} to={`/browse/${category.slug}`} className={styles.chip} aria-current={current ? 'page' : undefined}>
                {current && <m.span layoutId="chip-pill" className={styles.pill} aria-hidden="true" />}
                <span className={styles.label}>{category.label}</span>
              </Link>
            );
          })}
        </nav>
        {!edges.end && (
          <button type="button" className={`${styles.arrow} ${styles.right}`} onClick={() => scrollBy(1)} aria-label="Scroll categories right" tabIndex={-1}>
            <Icon name="chevronRight" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
