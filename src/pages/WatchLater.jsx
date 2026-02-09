import { useWatchLater } from '../hooks/useWatchLater.js';
import { Videos } from '../components/index.js';
import styles from './WatchLater.module.scss';

const WatchLater = () => {
  const { watchLater, clearWatchLater } = useWatchLater();

  return (
    <div className={`layout-container ${styles.container}`}>
      <header className={styles.header}>
        <div>
          <h2>Watch Later</h2>
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
          <h3>No videos saved yet</h3>
          <p>Tap the bookmark icon on any video to save it for later. Your saved videos will appear here.</p>
        </div>
      ) : (
        <Videos 
          videos={watchLater} 
          emptyLabel="No saved videos" 
        />
      )}
    </div>
  );
};

export default WatchLater;
