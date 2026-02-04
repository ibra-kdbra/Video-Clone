import { useWatchHistory } from '../hooks/useWatchHistory.js';
import { Videos } from '../components/index.js';
import styles from './History.module.scss';

const History = () => {
  const { history, clearHistory } = useWatchHistory();

  return (
    <div className={`layout-container ${styles.container}`}>
      <header className={styles.header}>
        <div>
          <h2>Watch History</h2>
          <p>{history.length} videos previously watched</p>
        </div>
        
        {history.length > 0 && (
          <button 
            className={styles.clearBtn}
            onClick={clearHistory}
          >
            Clear all history
          </button>
        )}
      </header>

      {history.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🕰️</div>
          <h3>Your history is empty</h3>
          <p>Videos you watch will show up here. Start exploring to build your personalized feed.</p>
        </div>
      ) : (
        <Videos 
          videos={history} 
          emptyLabel="No history yet" 
        />
      )}
    </div>
  );
};

export default History;
