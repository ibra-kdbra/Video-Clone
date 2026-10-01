import { lazy, Suspense, useEffect, useRef } from 'react';
import { m } from 'motion/react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigationType, useParams } from 'react-router-dom';

import BottomNav from '../components/BottomNav.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import RequireAuth from '../components/RequireAuth.jsx';
import Toaster from '../components/Toaster.jsx';
import TopBar from '../components/TopBar.jsx';
import UploadDock from '../components/UploadDock.jsx';
import { DEMO } from '../lib/demo.js';
// Most visits start on the home page, so it ships with the app instead of as a separate
// download; the other pages are their own chunks, loaded when first opened.
import Home from '../pages/Home.jsx';
import Motion from './Motion.jsx';
import SessionProvider from './Session.jsx';
import styles from './App.module.scss';

// The video Explore pages: the streaming-style home, browse, watch, search, channels, library.
const Explore = lazy(() => import('../pages/Explore.jsx'));
const Browse = lazy(() => import('../pages/Browse.jsx'));
const Watch = lazy(() => import('../pages/Watch.jsx'));
const Search = lazy(() => import('../pages/Search.jsx'));
const Channel = lazy(() => import('../pages/Channel.jsx'));
const Library = lazy(() => import('../pages/Library.jsx'));
const NotFound = lazy(() => import('../pages/NotFound.jsx'));
// Grand LMS: accounts and schools. These pages (and the form checks they share with the API) load
// only when opened, so the home page and the video pages don't carry them.
const SignIn = lazy(() => import('../pages/SignIn.jsx'));
const SignUp = lazy(() => import('../pages/SignUp.jsx'));
const Account = lazy(() => import('../pages/Account.jsx'));
const CreateSchool = lazy(() => import('../pages/CreateSchool.jsx'));
const School = lazy(() => import('../pages/School.jsx'));
const Invite = lazy(() => import('../pages/Invite.jsx'));
// Courses and lessons. The player (with hls.js), the Markdown renderer and the editor (with its
// drag and drop) are further chunks of their own, loaded by these pages when needed.
const Course = lazy(() => import('../pages/Course.jsx'));
const Lesson = lazy(() => import('../pages/Lesson.jsx'));
const CourseEditor = lazy(() => import('../pages/CourseEditor.jsx'));
// Learning progress: assignments' submissions and grading, and notifications.
const Submissions = lazy(() => import('../pages/Submissions.jsx'));
const Grading = lazy(() => import('../pages/Grading.jsx'));
const Notifications = lazy(() => import('../pages/Notifications.jsx'));
const NotificationSettings = lazy(() => import('../pages/NotificationSettings.jsx'));
// The demo's note under the top bar, only in demo builds.
const DemoBanner = DEMO ? lazy(() => import('../demo/DemoBanner.jsx')) : null;

/** Addresses from the previous version keep working. */
function OldVideo() {
  const { id } = useParams();
  return <Navigate to={`/watch/youtube/${encodeURIComponent(id)}`} replace />;
}

function OldSearch() {
  const { term } = useParams();
  return <Navigate to={`/search?q=${encodeURIComponent(term)}`} replace />;
}

/** Common guesses at the sign-in addresses lead to the real ones, keeping `?next=`. */
function Alias({ to }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
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
      {DEMO && (
        <Suspense fallback={null}>
          <DemoBanner />
        </Suspense>
      )}
      <main id="main" ref={main} tabIndex={-1} className={styles.main}>
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<div className={styles.loading} role="progressbar" aria-label="Loading page" />}>
            <PageTransition>
              <Routes>
                <Route index element={<Home />} />
                <Route path="explore" element={<Explore />} />
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
                <Route path="signin" element={<SignIn />} />
                <Route path="signup" element={<SignUp />} />
                <Route path="login" element={<Alias to="/signin" />} />
                <Route path="register" element={<Alias to="/signup" />} />
                <Route path="invite" element={<Invite />} />
                <Route path="s/:slug" element={<School />} />
                <Route path="s/:slug/c/:courseSlug" element={<Course />} />
                <Route path="s/:slug/c/:courseSlug/l/:lessonId" element={<Lesson />} />
                <Route path="s/:slug/c/:courseSlug/edit" element={<CourseEditor />} />
                <Route path="s/:slug/c/:courseSlug/l/:lessonId/submissions" element={<Submissions />} />
                <Route path="s/:slug/c/:courseSlug/l/:lessonId/submissions/:submissionId" element={<Grading />} />
                <Route
                  path="notifications"
                  element={
                    <RequireAuth>
                      <Notifications />
                    </RequireAuth>
                  }
                />
                <Route
                  path="schools/new"
                  element={
                    <RequireAuth>
                      <CreateSchool />
                    </RequireAuth>
                  }
                />
                <Route
                  path="account"
                  element={
                    <RequireAuth>
                      <Account />
                    </RequireAuth>
                  }
                />
                <Route
                  path="account/notifications"
                  element={
                    <RequireAuth>
                      <NotificationSettings />
                    </RequireAuth>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </PageTransition>
          </Suspense>
        </ErrorBoundary>
      </main>
      <BottomNav />
      <UploadDock />
      <Toaster />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Motion>
          <Layout />
        </Motion>
      </SessionProvider>
    </BrowserRouter>
  );
}
