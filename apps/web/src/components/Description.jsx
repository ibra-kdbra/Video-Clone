import { useState } from 'react';

import styles from './Description.module.scss';

const URL_PATTERN = /(https?:\/\/[^\s<>"'()]+)/g;

/** Only real web links become links; everything else stays text (React escapes it). */
function toSafeHref(candidate) {
  try {
    const url = new URL(candidate.replace(/[.,;:!?]+$/, ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function Linkified({ text }) {
  return text.split(URL_PATTERN).map((part, i) => {
    const href = i % 2 === 1 ? toSafeHref(part) : null;
    return href ? (
      <a key={i} href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
        {part}
      </a>
    ) : (
      part
    );
  });
}

/** The video's description: collapsed to a few lines, links clickable, with "Show more". */
export default function Description({ text, meta }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220 || text.split('\n').length > 3;

  return (
    <section className={styles.box} aria-label="Description">
      {meta && <p className={`${styles.meta} tabular`}>{meta}</p>}
      {text ? (
        <p className={`${styles.text} ${long && !open ? styles.clamped : ''}`}>
          <Linkified text={text} />
        </p>
      ) : (
        <p className={styles.empty}>No description.</p>
      )}
      {long && (
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </section>
  );
}
