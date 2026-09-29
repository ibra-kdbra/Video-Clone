import { lazy, Suspense, useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigationType, useParams } from 'react-router-dom';

import BottomNav from '../components/BottomNav.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import Toaster from '../components/Toaster.jsx';
import TopBar from '../components/TopBar.jsx';
// Most visits start on the home page, so it ships with the app instead of as a separate
// download; the other pages are their own chunks, loaded when first opened.
import Home from '../pages/Home.jsx';
import styles from './App.module.scss';

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
            <Routes>
              <Route index element={<Home />} />
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
      <Layout />
    </BrowserRouter>
  );
}
