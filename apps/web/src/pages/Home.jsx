import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router-dom';

import Billboard, { BillboardSkeleton } from '../components/Billboard.jsx';
import CategoryRow from '../components/CategoryRow.jsx';
import Row from '../components/Row.jsx';
import SchoolRow from '../components/SchoolRow.jsx';
import { ErrorState, Notice } from '../components/States.jsx';
import { HOME_ROWS, TRENDING, categoryBySlug } from '../lib/categories.js';
import { useHistory } from '../lib/library.js';
import { useSources } from '../lib/preferences.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useIdle } from '../lib/useIdle.js';
import { useSession } from '../lib/useSession.js';
import { categoryVideos } from '../lib/videos.js';
import styles from './Home.module.scss';

/**
 * The home page, laid out like a streaming service: featured billboard, then rows. Signed in, the
 * person's schools come first. The trending feed (one request per platform) fills the billboard,
 * Top 10 and "More trending"; each category row below loads when it scrolls near.
 */
export default function Home() {
  const [params] = useSearchParams();
  const sources = useSources();
  const history = useHistory();
  const { status, schools, schoolsLoading } = useSession();
  // The rows below the first screen render after the first paint, which keeps that paint fast.
  const later = useIdle();
  useDocumentTitle(null);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['feed', TRENDING.slug, sources],
    queryFn: () => categoryVideos(TRENDING, sources),
  });

  // Category links from the previous version (/?c=music) now live under /browse.
  const legacy = categoryBySlug(params.get('c'));
  if (legacy) return <Navigate to={`/browse/${legacy.slug}`} replace />;

  const videos = data?.videos ?? [];
  const featured = videos.filter((video) => video.thumbnail).slice(0, 5);

  return (
    <>
      <h1 className="visually-hidden">{status === 'signedIn' ? 'Grand LMS: your schools and trending videos' : 'Grand LMS: trending videos'}</h1>

      {isPending ? <BillboardSkeleton /> : featured.length > 0 && <Billboard videos={featured} />}

      <div className={`page ${styles.rows}`}>
        {data?.notice && <Notice>{data.notice}</Notice>}
        {status === 'signedIn' && <SchoolRow schools={schools} loading={schoolsLoading} />}
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}

        {history.length > 0 && <Row title="Continue watching" href="/library?tab=history" videos={history.slice(0, 15)} />}
        {!isError && <Row title="Top 10 today" ranked videos={videos.slice(0, 10)} loading={isPending} />}
        {later && (
          <>
            {!isError && <Row title="More trending" href="/browse/trending" videos={videos.slice(10, 24)} loading={isPending} />}
            {HOME_ROWS.map((slug) => (
              <CategoryRow key={slug} category={categoryBySlug(slug)} />
            ))}
          </>
        )}
      </div>
    </>
  );
}
