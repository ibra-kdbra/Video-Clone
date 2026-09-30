import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import ChipBar from '../components/ChipBar.jsx';
import { EmptyState, ErrorState, Notice } from '../components/States.jsx';
import VideoGrid from '../components/VideoGrid.jsx';
import { categoryBySlug } from '../lib/categories.js';
import { useSources } from '../lib/preferences.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { categoryVideos } from '../lib/videos.js';
import NotFound from './NotFound.jsx';
import styles from './Browse.module.scss';

const PAGE = 24;

/** The grid of a category's videos: the first 24, then the rest on request. */
function Results({ videos, loading }) {
  const [limit, setLimit] = useState(PAGE);
  return (
    <>
      <h2 className="visually-hidden">Videos</h2>
      <VideoGrid loading={loading} videos={videos.slice(0, limit)} priorityCount={4} />
      {!loading && videos.length > limit && (
        <div className={styles.more}>
          <button type="button" onClick={() => setLimit((n) => n + PAGE)}>
            Show more
          </button>
        </div>
      )}
    </>
  );
}

export default function Browse() {
  const { slug } = useParams();
  const category = categoryBySlug(slug);
  const sources = useSources();
  useDocumentTitle(category?.label);

  const { data, isPending, isPlaceholderData, isError, error, refetch } = useQuery({
    queryKey: ['feed', slug, sources],
    queryFn: () => categoryVideos(category, sources),
    enabled: Boolean(category),
    // Keep showing the previous category while the next one loads, instead of a blank page.
    placeholderData: keepPreviousData,
  });

  if (!category) return <NotFound title="Category not found">Pick one of the categories on the Browse page.</NotFound>;

  return (
    <div className="page">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Browse</p>
        <h1 key={slug} className={styles.title}>
          {category.label}
        </h1>
        <p className={styles.blurb}>{category.blurb}</p>
      </header>

      <ChipBar active={slug} />

      <div className={`${styles.body} ${isPlaceholderData ? styles.stale : ''}`}>
        {data?.notice && <Notice>{data.notice}</Notice>}
        {isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !isPending && data.videos.length === 0 ? (
          <EmptyState title="Nothing here yet">Try another category, or turn on more sources.</EmptyState>
        ) : (
          // A new category starts again from the first page (key).
          <Results key={slug} videos={data?.videos ?? []} loading={isPending} />
        )}
      </div>
    </div>
  );
}
