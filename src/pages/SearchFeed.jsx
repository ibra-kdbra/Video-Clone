import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { searchVideos } from '../services/youtubeApi.js';
import { Videos, VideoSkeleton } from '../components/index.js';
import styles from './SearchFeed.module.scss';

const SearchFeed = () => {
  const { searchTerm } = useParams();

  const {
    data: videos = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['search', searchTerm],
    queryFn: () => searchVideos(searchTerm),
    enabled: Boolean(searchTerm),
  });

  return (
    <div className={`layout-container ${styles.container}`}>
      <header className={styles.header}>
        <h2>
          Search results for <span className={styles.searchTerm}>{searchTerm}</span>
        </h2>
        <p className={styles.resultCount}>{videos.length} videos found</p>
      </header>

      {isError && (
        <div className={styles.errorAlert}>
          <span>⚠️</span>
          {error?.message || 'Something went wrong while searching.'}
        </div>
      )}

      {isLoading ? (
        <VideoSkeleton count={12} />
      ) : (
        <Videos
          videos={videos}
          emptyLabel="No results matched your search."
          emptyDescription="Try a different keyword or explore a category instead."
        />
      )}
    </div>
  );
};

export default SearchFeed;
