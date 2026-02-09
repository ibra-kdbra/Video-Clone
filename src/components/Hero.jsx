import styles from './Hero.module.scss';
import { demoThumbnailUrl } from '../utils/constants';

const Hero = ({ video }) => {
  // Support both normalized (multi-provider) and raw YouTube video shapes
  const isNormalized = Boolean(video?.provider);

  const bgImage = isNormalized
    ? (video.thumbnail || demoThumbnailUrl)
    : (video?.snippet?.thumbnails?.high?.url || demoThumbnailUrl);

  const rawTitle = isNormalized ? video.title : video?.snippet?.title;
  const title = rawTitle ? rawTitle.slice(0, 30) + (rawTitle.length > 30 ? "..." : "") : "Experience StreamVerse";

  const subtitle = isNormalized
    ? (video.description || "Join millions of viewers discovering the premium content universe. Curated just for you.")
    : (video?.snippet?.description || "Join millions of viewers discovering the premium content universe. Curated just for you.");

  return (
    <div className={styles.heroContainer}>
      <div className={styles.heroCard}>
        <img src={bgImage} alt="Hero Background" className={styles.bgImage} />
        
        <div className={styles.content}>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          <button className={styles.actionBtn}>
            Start Watching
          </button>
        </div>

        <div className={styles.floatingBadge}>
          Featured
        </div>
      </div>
    </div>
  );
};

export default Hero;
