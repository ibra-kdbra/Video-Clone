import { useState } from 'react';

import { SOURCE_LABELS, embedUrl } from '../lib/sources.js';
import Icon from './Icon.jsx';
import styles from './Player.module.scss';

/**
 * The video player. Until the visitor presses play it's just the poster image: no third-party
 * frame, script or cookie loads, which keeps the page fast and private. The embed then loads
 * from the platform's own player (YouTube's no-cookie domain, Dailymotion, Twitch clips).
 */
export default function Player({ video, onPlay }) {
  const [playing, setPlaying] = useState(false);
  const poster = video.thumbnails?.at(-1)?.url ?? video.thumbnail;
  const source = SOURCE_LABELS[video.provider];

  if (playing)
    return (
      <div className={styles.frame}>
        <iframe
          src={embedUrl(video.provider, video.id)}
          title={`${video.title} (${source} player)`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );

  return (
    <div className={styles.frame}>
      <button
        type="button"
        className={styles.facade}
        onClick={() => {
          setPlaying(true);
          onPlay?.();
        }}
        aria-label={`Play "${video.title}"`}
      >
        {poster && <img src={poster} alt="" width="1280" height="720" fetchPriority="high" decoding="async" />}
        <span className={styles.play} aria-hidden="true">
          <Icon name="play" size={30} />
        </span>
        <span className={styles.note}>Plays from {source}</span>
      </button>
    </div>
  );
}
