import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Navbar, Sidebar } from '../components/index.js';
import { UIProvider, useUI } from '../context/UIContext.jsx';
import Feed from '../pages/Feed.jsx';
import VideoDetail from '../pages/VideoDetail.jsx';
import ChannelDetail from '../pages/ChannelDetail.jsx';
import SearchFeed from '../pages/SearchFeed.jsx';
import History from '../pages/History.jsx';
import '../styles/layout/_main.scss';

const AppLayout = () => {
  const { sidebarOpen } = useUI();
  return (
    <div className="mainAPI-layout">
      <Sidebar />
      <div className={`mainContent-area ${!sidebarOpen ? 'sidebar-collapsed' : ''}`}>
          <Navbar />
          <div className="page-content">
            <Routes>
              {/* PageLayout is redundant for basic structure now, removed for flatter hierarchy */}
              <Route path="/" element={<Feed />} />
              <Route path="/video/:id" element={<VideoDetail />} />
              <Route path="/channel/:id" element={<ChannelDetail />} />
              <Route path="/search/:searchTerm" element={<SearchFeed />} />
              <Route path="/history" element={<History />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
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
