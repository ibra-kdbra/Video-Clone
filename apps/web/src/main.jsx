import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@fontsource-variable/inter';
import './styles/main.scss';
import App from './app/App.jsx';
import { TRENDING } from './lib/categories.js';
import { captureInviteToken } from './lib/invite.js';
import { getSources } from './lib/preferences.js';
import { restoreSession } from './lib/session.js';
import { categoryVideos } from './lib/videos.js';

// Before anything renders: take an invitation's token out of the address bar, and start picking up
// the session from the last visit (if there was one), in parallel with rendering.
captureInviteToken();
restoreSession();
// Progress used to be kept in this browser; it's on the server now, so the old copy goes.
try {
  localStorage.removeItem('grand.progress');
} catch {
  // Storage blocked: nothing to clear.
}

// The form checks shared with the API use zod, which otherwise probes for `new Function` to speed
// itself up. The CSP forbids that, and Trusted Types report even the caught attempt as a
// violation, so it's told not to try (zod reads this shared config object when it loads).
(globalThis.__zod_globalConfig ??= {}).jitless = true;

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

// On the Explore page, ask for the trending feed right away, in parallel with rendering.
if (window.location.pathname === '/explore') {
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
