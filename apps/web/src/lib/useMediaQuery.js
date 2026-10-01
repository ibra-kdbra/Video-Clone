import { useCallback, useSyncExternalStore } from 'react';

/** Whether a media query matches now, following it as it changes (a window resized, a phone turned). */
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (listener) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
