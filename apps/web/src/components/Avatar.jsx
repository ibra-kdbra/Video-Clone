import styles from './Avatar.module.scss';

/** A channel picture, or its initial on a tinted circle when there's no picture. */
export default function Avatar({ src, name = '', size = 36 }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span className={styles.avatar} style={{ '--size': `${size}px` }} aria-hidden="true">
      {src ? <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" /> : initial}
    </span>
  );
}
