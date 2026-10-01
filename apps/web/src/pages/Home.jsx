import { lazy, Suspense } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

import Landing from '../components/Landing.jsx';
import { Block } from '../components/Skeleton.jsx';
import { categoryBySlug } from '../lib/categories.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useSession } from '../lib/useSession.js';

// Signed in, the home page is a dashboard of the person's courses: its own chunk, which loads
// while the session is being picked up.
const Dashboard = lazy(() => import('../components/Dashboard.jsx'));

function HomeSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <div style={{ height: 'clamp(1rem, 3vw, 2rem)' }} />
      <Block width="min(22rem, 80%)" height="2.4rem" />
      <div style={{ height: '1rem' }} />
      <Block width="min(640px, 100%)" height="9rem" radius="var(--radius-lg)" />
    </div>
  );
}

/**
 * The home page (/): Grand LMS itself. Visitors get what it is and the way in (the landing page);
 * people signed in get their dashboard. The video Explore pages are at /explore.
 */
export default function Home() {
  const [params] = useSearchParams();
  const { status } = useSession();
  useDocumentTitle(null);

  // Category links from the first version (/?c=music) now live under /browse.
  const legacy = categoryBySlug(params.get('c'));
  if (legacy) return <Navigate to={`/browse/${legacy.slug}`} replace />;

  if (status === 'loading') return <HomeSkeleton />;
  if (status === 'signedIn')
    return (
      <Suspense fallback={<HomeSkeleton />}>
        <Dashboard />
      </Suspense>
    );
  return <Landing />;
}
