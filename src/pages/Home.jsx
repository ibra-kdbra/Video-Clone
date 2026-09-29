import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import ChipBar from '../components/ChipBar.jsx';
import Shelf from '../components/Shelf.jsx';
import SourcePicker from '../components/SourcePicker.jsx';
import Spotlight, { SpotlightSkeleton } from '../components/Spotlight.jsx';
import { EmptyState, ErrorState, Notice } from '../components/States.jsx';
import VideoGrid from '../components/VideoGrid.jsx';
import { categoryBySlug } from '../lib/categories.js';
import { useHistory } from '../lib/library.js';
import { useSources } from '../lib/preferences.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { categoryVideos } from '../lib/videos.js';
import styles from './Home.module.scss';

const PAGE = 24;

/** The grid below the spotlight: the first 24 videos, then the rest on request. */
function Feed({ title, videos, loading }) {
  const [limit, setLimit] = useState(PAGE);
  return (
    <section aria-labelledby="feed-title">
      <h2 id="feed-title" className={styles.sectionTitle}>
        {title}
      </h2>
      <VideoGrid loading={loading} videos={videos.slice(0, limit)} />
      {!loading && videos.length > limit && (
        <div className={styles.more}>
          <button type="button" onClick={() => setLimit((n) => n + PAGE)}>
            Show more
          </button>
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const [params] = useSearchParams();
  const category = categoryBySlug(params.get('c'));
  const sources = useSources();
  const history = useHistory();
  useDocumentTitle(category.trending ? null : category.label);

  const { data, isPending, isPlaceholderData, isError, error, refetch } = useQuery({
    queryKey: ['feed', category.slug, sources],
    queryFn: () => categoryVideos(category, sources),
    // Keep showing the previous category while the next one loads, instead of a blank page.
    placeholderData: keepPreviousData,
  });
  const [featured, ...rest] = data?.videos ?? [];

  return (
    <div className="page">
      <h1 className="visually-hidden">{category.trending ? 'Trending videos' : `${category.label} videos`}</h1>
      <ChipBar active={category.slug}>
        <SourcePicker />
      </ChipBar>

      <div className={`${styles.body} ${isPlaceholderData ? styles.stale : ''}`}>
        {data?.notice && <Notice>{data.notice}</Notice>}

        {isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isPending ? (
          <SpotlightSkeleton />
        ) : featured ? (
          <Spotlight video={featured} eyebrow={category.trending ? 'Trending' : category.label} />
        ) : (
          <EmptyState title="Nothing here yet">Try another category, or turn on more sources.</EmptyState>
        )}

        {category.trending && history.length > 0 && (
          <Shelf title="Continue watching" videos={history.slice(0, 12)} moreHref="/library?tab=history" />
        )}

        {!isError && (isPending || rest.length > 0) && (
          // A new category starts again from the first page (key).
          <Feed
            key={category.slug}
            title={category.trending ? 'Popular right now' : `More in ${category.label}`}
            videos={rest}
            loading={isPending}
          />
        )}
      </div>
    </div>
  );
}
