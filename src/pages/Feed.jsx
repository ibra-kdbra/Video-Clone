import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { searchVideos } from '../services/youtubeApi.js';
import { Sidebar, Videos, VideoSkeleton } from '../components/index.js';
import styles from './Feed.module.scss';

const Feed = () => {
  const [selectedCategory, setSelectedCategory] = useState('New');

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
      <main className={styles.feed}>
        <div className={styles.sidebarSection}>
          <Sidebar
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
          />
        </div>

        <div className={styles.contentSection}>
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
      </main>
    </div>
  );
};

export default Feed;
