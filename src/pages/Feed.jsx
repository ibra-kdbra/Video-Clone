import { useQuery } from '@tanstack/react-query';

import { multiSearch } from '../services/providers/index.js';
import { Videos, VideoSkeleton, Hero } from '../components/index.js';
import { useUI } from '../context/UIContext.jsx';
import styles from './Feed.module.scss';

const Feed = () => {
  const { selectedCategory, activeProviders } = useUI();

  const {
    data: videos = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['search', selectedCategory, activeProviders],
    queryFn: () => multiSearch(selectedCategory, activeProviders),
  });

  return (
    <div className="layout-container">
      {!isLoading && !isError && <Hero video={videos[0]} />}

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
          videos={videos} // Pass all videos, could slice to exclude first if needed
          emptyLabel="No videos in this category yet."
          emptyDescription="Try a different category or check back soon for new uploads."
        />
      )}
    </div>
  );
};

export default Feed;
