import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@fontsource-variable/inter';
import './styles/main.scss';
import App from './app/App.jsx';
import { categoryBySlug } from './lib/categories.js';
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

// On the home page, ask for the feed right away, in parallel with rendering, rather than after.
if (window.location.pathname === '/') {
  const category = categoryBySlug(new URLSearchParams(window.location.search).get('c'));
  const sources = getSources();
  queryClient.prefetchQuery({ queryKey: ['feed', category.slug, sources], queryFn: () => categoryVideos(category, sources) });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
