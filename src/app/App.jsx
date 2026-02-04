import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Navbar } from '../components/index.js';
import Feed from '../pages/Feed.jsx';
import VideoDetail from '../pages/VideoDetail.jsx';
import ChannelDetail from '../pages/ChannelDetail.jsx';
import SearchFeed from '../pages/SearchFeed.jsx';
import History from '../pages/History.jsx';

const App = () => (
  <BrowserRouter>
    <div className="app-wrapper">
      <Navbar />
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/video/:id" element={<VideoDetail />} />
        <Route path="/channel/:id" element={<ChannelDetail />} />
        <Route path="/search/:searchTerm" element={<SearchFeed />} />
        <Route path="/history" element={<History />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  </BrowserRouter>
);

export default App;
