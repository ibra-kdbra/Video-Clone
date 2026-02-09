import styles from './Hero.module.scss';
import { demoThumbnailUrl } from '../utils/constants';

const Hero = ({ video }) => {
  // Use the passed video or fallbacks
  const bgImage = video?.snippet?.thumbnails?.high?.url || demoThumbnailUrl;
  const title = video?.snippet?.title ? video.snippet.title.slice(0, 30) + (video.snippet.title.length > 30 ? "..." : "") : "Experience StreamVerse";
  const subtitle = video?.snippet?.description || "Join millions of viewers discovering the premium content universe. Curated just for you.";

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
