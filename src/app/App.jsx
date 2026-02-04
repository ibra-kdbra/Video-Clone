import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Navbar, PageLayout } from '../components/index.js';
import { UIProvider } from '../context/UIContext.jsx';
import Feed from '../pages/Feed.jsx';
import VideoDetail from '../pages/VideoDetail.jsx';
import ChannelDetail from '../pages/ChannelDetail.jsx';
import SearchFeed from '../pages/SearchFeed.jsx';
import History from '../pages/History.jsx';

const App = () => (
  <UIProvider>
    <BrowserRouter>
      <div className="app-wrapper">
        <Navbar />
        <Routes>
          <Route path="/" element={<PageLayout><Feed /></PageLayout>} />
          <Route path="/video/:id" element={<VideoDetail />} />
          <Route path="/channel/:id" element={<ChannelDetail />} />
          <Route path="/search/:searchTerm" element={<PageLayout><SearchFeed /></PageLayout>} />
          <Route path="/history" element={<PageLayout><History /></PageLayout>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  </UIProvider>
);

export default App;
