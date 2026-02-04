import { useQuery } from '@tanstack/react-query';

import { searchVideos } from '../services/youtubeApi.js';
import { Videos, VideoSkeleton } from '../components/index.js';
import { useUI } from '../context/UIContext.jsx';
import styles from './Feed.module.scss';

const Feed = () => {
  const { selectedCategory } = useUI();

  const {
    data: videos = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['search', selectedCategory],
    queryFn: () => searchVideos(selectedCategory),
  });

  return (
    <div className="layout-container">
      <section className={styles.hero}>
        <span className={styles.categoryBadge}>{selectedCategory}</span>
        <h2>Your premium stream, <span>curated for you</span></h2>
        <p>Explore high-quality content across the {selectedCategory} niche.</p>
      </section>

      {isError && (
        <div className={styles.errorAlert}>
          <span>⚠️</span>
          {error?.message || 'Failed to load videos. Please try again later.'}
        </div>
      )}

      {isLoading ? (
        <VideoSkeleton count={12} />
      ) : (
        <Videos
          videos={videos}
          emptyLabel="No videos in this category yet."
          emptyDescription="Try a different category or check back soon for new uploads."
        />
      )}
    </div>
  );
};

export default Feed;
