import { useWatchLater } from '../hooks/useWatchLater.js';
import { Videos } from '../components/index.js';
import styles from './WatchLater.module.scss';

const WatchLater = () => {
  const { watchLater, clearWatchLater } = useWatchLater();

  return (
    <div className={`layout-container ${styles.container}`}>
      <header className={styles.header}>
        <div>
          <h1>Watch Later</h1>
          <p>{watchLater.length} {watchLater.length === 1 ? 'video' : 'videos'} saved</p>
        </div>
        
        {watchLater.length > 0 && (
          <button 
            className={styles.clearBtn}
            onClick={clearWatchLater}
          >
            Clear all
          </button>
        )}
      </header>

      {watchLater.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🔖</div>
          <h2>No videos saved yet</h2>
          <p>Tap the bookmark icon on any video to save it for later. Your saved videos will appear here.</p>
        </div>
      ) : (
        <Videos
          titleAs="h2"
          videos={watchLater} 
          emptyLabel="No saved videos" 
        />
      )}
    </div>
  );
};

export default WatchLater;
