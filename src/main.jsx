import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@fontsource-variable/inter';
import './styles/main.scss';
import App from './app/App.jsx';
import { TRENDING } from './lib/categories.js';
import { getSources } from './lib/preferences.js';
import { categoryVideos } from './lib/videos.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      // Retry network hiccups once; a missing video or a used-up quota won't change on retry.
      retry: (failures, error) => failures < 1 && (error?.status === 0 || [502, 504].includes(error?.status)),
    },
  },
});

// On the home page, ask for the trending feed right away, in parallel with rendering.
if (window.location.pathname === '/' && !window.location.search.includes('c=')) {
  const sources = getSources();
  queryClient.prefetchQuery({ queryKey: ['feed', TRENDING.slug, sources], queryFn: () => categoryVideos(TRENDING, sources) });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
