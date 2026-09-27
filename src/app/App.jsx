import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Loader, Navbar, Sidebar } from '../components/index.js';
import { UIProvider, useUI } from '../context/UIContext.jsx';
import '../styles/layout/_main.scss';

// Each page is its own chunk: the home feed doesn't download the video player, the channel page,
// or the history and watch-later lists until they're opened.
const Feed = lazy(() => import('../pages/Feed.jsx'));
const VideoDetail = lazy(() => import('../pages/VideoDetail.jsx'));
const ChannelDetail = lazy(() => import('../pages/ChannelDetail.jsx'));
const SearchFeed = lazy(() => import('../pages/SearchFeed.jsx'));
const History = lazy(() => import('../pages/History.jsx'));
const WatchLater = lazy(() => import('../pages/WatchLater.jsx'));

const AppLayout = () => {
  const { sidebarOpen } = useUI();
  return (
    <div className="mainAPI-layout">
      <Sidebar />
      <div className={`mainContent-area ${!sidebarOpen ? 'sidebar-collapsed' : ''}`}>
        <Navbar />
        <main className="page-content">
          <Suspense fallback={<Loader label="Loading" />}>
            <Routes>
              <Route path="/" element={<Feed />} />
              <Route path="/video/:id" element={<VideoDetail />} />
              <Route path="/channel/:id" element={<ChannelDetail />} />
              <Route path="/search/:searchTerm" element={<SearchFeed />} />
              <Route path="/history" element={<History />} />
              <Route path="/watch-later" element={<WatchLater />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
};

const App = () => (
  <UIProvider>
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  </UIProvider>
);

export default App;
