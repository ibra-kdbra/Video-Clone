import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@fontsource-variable/inter';
import './styles/main.scss';
import App from './app/App.jsx';
import { captureInviteToken } from './lib/invite.js';
import { restoreSession } from './lib/session.js';

// Before anything renders: take an invitation's token out of the address bar, and start picking up
// the session from the last visit (if there was one), in parallel with rendering.
captureInviteToken();
restoreSession();
// What this browser kept for things that have moved or gone: lesson progress (on the server now),
// and the old video browser's watch history, saved videos, recent searches and platform choice.
const STALE_KEYS = ['grand.progress', 'fs.history.v2', 'fs.saved.v2', 'fundastream_watch_history', 'fundastream_watch_later', 'fs.recent', 'fs.sources'];
try {
  for (const key of STALE_KEYS) localStorage.removeItem(key);
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
      // Retry network hiccups once; anything else (not found, not allowed…) won't change on retry.
      retry: (failures, error) => failures < 1 && (error?.status === 0 || [502, 504].includes(error?.status)),
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
