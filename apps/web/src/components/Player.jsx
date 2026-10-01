import { useState } from 'react';

import { SOURCE_LABELS, embedUrl } from '../lib/sources.js';
import Icon from './Icon.jsx';
import styles from './Player.module.scss';

/**
 * The video player. Until the visitor presses play it's just the poster image: no third-party
 * frame, script or cookie loads, which keeps the page fast and private. The embed then loads
 * from the platform's own player (YouTube's no-cookie domain, Dailymotion, Twitch clips).
 * `autoStart` skips the poster, for "Play" buttons elsewhere that already expressed the intent.
 */
export default function Player({ video, onPlay, autoStart = false }) {
  const [playing, setPlaying] = useState(autoStart);
  const poster = video.thumbnails?.at(-1)?.url ?? video.thumbnail;
  const glow = video.thumbnails?.[0]?.url ?? video.thumbnail;
  const source = SOURCE_LABELS[video.provider];

  return (
    <div className={styles.stage}>
      {/* Ambient light: the video's own colors, blurred, glowing behind the player. */}
      {glow && (
        <div className={styles.ambient} aria-hidden="true">
          <img src={glow} alt="" width="320" height="180" decoding="async" />
        </div>
      )}
      {playing ? (
        <div className={styles.frame}>
          <iframe
            src={embedUrl(video.provider, video.id)}
            title={`${video.title} (${source} player)`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
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
      )}
    </div>
  );
}
