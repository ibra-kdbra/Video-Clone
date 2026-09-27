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

      <h2 className={styles.sectionTitle}>{selectedCategory} videos</h2>

      {isLoading ? (
        <VideoSkeleton count={12} />
      ) : (
        <Videos
          // The first video is the hero above, so the grid starts with the second.
          videos={videos.length > 1 ? videos.slice(1) : videos}
          emptyLabel="No videos in this category yet."
          emptyDescription="Try a different category or check back soon for new uploads."
        />
      )}
    </div>
  );
};

export default Feed;
