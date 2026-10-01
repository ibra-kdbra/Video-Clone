import styles from './Backdrop.module.scss';

// A fixed, even-looking scatter of the six gradients across the wall.
const TILES = Array.from({ length: 40 }, (_, i) => ((i * 7 + Math.floor(i / 8) * 3) % 6) + 1);

/**
 * The cinematic backdrop of the sign-in, invitation and school welcome screens: a tilted wall of
 * gradient "lesson thumbnails" drifting slowly under a vignette, the way streaming services dress
 * their sign-in pages. It's all CSS (nothing to download) and purely decorative. `tone` tints the
 * glow with a school's colors.
 */
export default function Backdrop({ tone }) {
  return (
    <div className={styles.backdrop} aria-hidden="true">
      <div className={styles.wall}>
        {TILES.map((tileTone, i) => (
          <span key={i} className={styles.tile} data-tone={tileTone} />
        ))}
      </div>
      <div className={styles.glow} data-tone={tone} data-tinted={Boolean(tone)} />
      <div className={styles.vignette} />
    </div>
  );
}
