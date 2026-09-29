import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import Icon, { SourceMark } from '../components/Icon.jsx';
import SearchBox, { MAX_QUERY } from '../components/SearchBox.jsx';
import { RowSkeleton } from '../components/Skeleton.jsx';
import SourcePicker from '../components/SourcePicker.jsx';
import { EmptyState, ErrorState, Notice } from '../components/States.jsx';
import VideoCard from '../components/VideoCard.jsx';
import { CATEGORIES } from '../lib/categories.js';
import { rememberSearch, useRecentSearches, useSources } from '../lib/preferences.js';
import { SOURCES, SOURCE_LABELS } from '../lib/sources.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { normalizeQuery, searchVideos } from '../lib/videos.js';
import styles from './Search.module.scss';

/** No query yet (phones open this from the bottom bar): the field, recent searches, categories. */
function Start() {
  const recent = useRecentSearches();
  useDocumentTitle('Search');
  return (
    <div className={`page ${styles.start}`}>
      <h1 className={styles.startTitle}>Search</h1>
      <SearchBox autoFocus />
      {recent.length > 0 && (
        <section aria-labelledby="recent-title">
          <h2 id="recent-title" className={styles.subTitle}>
            Recent searches
          </h2>
          <ul className={styles.recent}>
            {recent.map((q) => (
              <li key={q}>
                <Link to={`/search?q=${encodeURIComponent(q)}`}>
                  <Icon name="clock" size={18} />
                  {q}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="browse-title">
        <h2 id="browse-title" className={styles.subTitle}>
          Browse categories
        </h2>
        <div className={styles.categories}>
          {CATEGORIES.map((category) => (
            <Link key={category.slug} to={category.trending ? '/' : `/?c=${category.slug}`} className={styles.category}>
              {category.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Results({ q }) {
  const sources = useSources();
  const [filter, setFilter] = useState('all');
  useDocumentTitle(`“${q}”`);

  // Searches opened from a link or the address bar count as recent too.
  useEffect(() => rememberSearch(q), [q]);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['search', normalizeQuery(q), sources],
    queryFn: () => searchVideos(q, sources),
  });

  const videos = data?.videos ?? [];
  const present = SOURCES.filter((source) => videos.some((video) => video.provider === source));
  const shown = filter === 'all' ? videos : videos.filter((video) => video.provider === filter);

  return (
    <div className="page">
      <div className={styles.mobileSearch}>
        <SearchBox />
      </div>

      <header className={styles.header}>
        <div className={styles.headText}>
          <h1 className={styles.title}>
            Results for <span className={styles.query}>“{q}”</span>
          </h1>
          {!isPending && !isError && <p className={`${styles.count} tabular`}>{shown.length === 1 ? '1 video' : `${shown.length} videos`}</p>}
        </div>
        <SourcePicker />
      </header>

      {data?.notice && <Notice>{data.notice}</Notice>}

      {present.length > 1 && (
        <div className={styles.filters} role="group" aria-label="Show results from">
          {['all', ...present].map((value) => (
            <button key={value} type="button" className={styles.filter} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {value !== 'all' && <SourceMark source={value} size={14} />}
              {value === 'all' ? 'All' : SOURCE_LABELS[value]}
            </button>
          ))}
        </div>
      )}

      {isPending ? (
        <div className={styles.results} aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState title="No results">Try different words, or turn on more sources.</EmptyState>
      ) : (
        <ol className={styles.results}>
          {shown.map((video, i) => (
            <li key={`${video.provider}:${video.id}`}>
              <VideoCard
                video={video}
                layout="result"
                titleAs="h2"
                priority={i < 2}
                extra={video.description && <p className={styles.snippet}>{video.description}</p>}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function Search() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY);
  // A new query starts with a fresh filter.
  return q ? <Results key={q} q={q} /> : <Start />;
}
