import { lazy, Suspense, useEffect, useRef } from 'react';
import { m } from 'motion/react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigationType, useParams } from 'react-router-dom';

import BottomNav from '../components/BottomNav.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import Toaster from '../components/Toaster.jsx';
import TopBar from '../components/TopBar.jsx';
// Most visits start on the home page, so it ships with the app instead of as a separate
// download; the other pages are their own chunks, loaded when first opened.
import Home from '../pages/Home.jsx';
import Motion from './Motion.jsx';
import styles from './App.module.scss';

const Browse = lazy(() => import('../pages/Browse.jsx'));
const Watch = lazy(() => import('../pages/Watch.jsx'));
const Search = lazy(() => import('../pages/Search.jsx'));
const Channel = lazy(() => import('../pages/Channel.jsx'));
const Library = lazy(() => import('../pages/Library.jsx'));
const NotFound = lazy(() => import('../pages/NotFound.jsx'));

/** Addresses from the previous version keep working. */
function OldVideo() {
  const { id } = useParams();
  return <Navigate to={`/watch/youtube/${encodeURIComponent(id)}`} replace />;
}

function OldSearch() {
  const { term } = useParams();
  return <Navigate to={`/search?q=${encodeURIComponent(term)}`} replace />;
}

/**
 * On a new page (not back/forward), start at the top and move focus to the main content, so
 * keyboard and screen-reader users land on the new page rather than the link they pressed.
 */
function useNewPageFocus(main) {
  const { pathname } = useLocation();
  const type = useNavigationType();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (type === 'POP') return;
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [pathname, type, main]);
}

/**
 * Each new page fades and rises into place. The first page renders as is, with no animation, so
 * nothing waits on the animation engine (which loads after the first paint).
 */
function PageTransition({ children }) {
  const { pathname } = useLocation();
  const firstPath = useRef(pathname);
  const navigated = useRef(false);
  if (pathname !== firstPath.current) navigated.current = true;
  return (
    <m.div
      key={pathname}
      className={styles.page}
      initial={navigated.current ? { opacity: 0, y: 12 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </m.div>
  );
}

function Layout() {
  const main = useRef(null);
  const { pathname } = useLocation();
  useNewPageFocus(main);

  return (
    <>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <TopBar />
      <main id="main" ref={main} tabIndex={-1} className={styles.main}>
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<div className={styles.loading} role="progressbar" aria-label="Loading page" />}>
            <PageTransition>
              <Routes>
                <Route index element={<Home />} />
                <Route path="browse" element={<Navigate to="/browse/trending" replace />} />
                <Route path="browse/:slug" element={<Browse />} />
                <Route path="watch/:provider/:id" element={<Watch />} />
                <Route path="search" element={<Search />} />
                <Route path="channel/:id" element={<Channel />} />
                <Route path="library" element={<Library />} />
                <Route path="video/:id" element={<OldVideo />} />
                <Route path="search/:term" element={<OldSearch />} />
                <Route path="history" element={<Navigate to="/library?tab=history" replace />} />
                <Route path="watch-later" element={<Navigate to="/library?tab=saved" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </PageTransition>
          </Suspense>
        </ErrorBoundary>
      </main>
      <BottomNav />
      <Toaster />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Motion>
        <Layout />
      </Motion>
    </BrowserRouter>
  );
}
