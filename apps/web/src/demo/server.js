import * as CONTENT from './content.js';
import { createServer } from './core.js';
import { MEDIA } from './media.js';
import { STORAGE_KEY } from './store.js';

/**
 * The demo's one mock API, for the app (see src/lib/demo.js, which loads this module only in demo
 * builds, as its own chunk). session.js sends every `/api/v1` request to `demoFetch` instead of
 * the network; the rest is for the demo's own screens.
 */
export const server = createServer({ content: CONTENT, media: MEDIA });

export const demoFetch = (url, init) => server.fetch(url, init);
export const personas = () => server.personas();
export const showcase = () => server.showcase();
export const startPage = (userId) => server.startPage(userId);
export const resetDemo = () => server.reset();
export const DEMO_PASSWORD = CONTENT.DEMO_PASSWORD;

/** Saves a handed-in file kept in this tab, from the address the API gave for it. */
export function saveFile(url) {
  const link = document.createElement('a');
  link.href = url;
  link.download = server.files.nameFor(url);
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

// Another tab changed the demo: pick up its changes (its sign-in, say) before the next request.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) server.reload();
  });
}
