import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Text that saves itself: `delay` ms after the last change, when the field loses focus (`flush`),
 * and, as a last resort, with `saveOnExit` (fetch keepalive) when the page is hidden or closed or
 * this unmounts with changes still unsaved. Saves go one at a time, in order; whatever is typed
 * meanwhile is saved next. A failed save keeps the text and says so (`status` 'error'), and the
 * next change or `flush()` tries again.
 *
 * `status`: 'saved', 'dirty' (changed, not sent yet), 'saving' or 'error'. `flush()` resolves once
 * everything typed so far is saved (and rejects if it couldn't be).
 */
export function useAutosave({ initial, save, saveOnExit, delay = 1200 }) {
  const [value, setValueState] = useState(initial);
  const [status, setStatus] = useState('saved');
  const latest = useRef(initial);
  const saved = useRef(initial);
  const timer = useRef(null);
  const queue = useRef(Promise.resolve());
  const savers = useRef({ save, saveOnExit });
  useEffect(() => {
    savers.current = { save, saveOnExit };
  });

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const run = async () => {
      const text = latest.current;
      if (text === saved.current) {
        setStatus('saved');
        return;
      }
      setStatus('saving');
      try {
        await savers.current.save(text);
        saved.current = text;
        setStatus(latest.current === text ? 'saved' : 'dirty');
      } catch (error) {
        setStatus('error');
        throw error;
      }
    };
    const next = queue.current.then(run, run);
    // The queue itself never stays rejected, so the next save still runs.
    queue.current = next.catch(() => {});
    return next;
  }, []);

  const setValue = useCallback(
    (text) => {
      latest.current = text;
      setValueState(text);
      setStatus(text === saved.current ? 'saved' : 'dirty');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => flush().catch(() => {}), delay);
    },
    [delay, flush],
  );

  useEffect(() => {
    // The page may be going away: a request that outlives it. Leaving within the app (unmounting),
    // the page stays, so an ordinary save will do.
    const last = (send) => {
      if (latest.current === saved.current || !send) return;
      const text = latest.current;
      send(text).then(
        () => {
          saved.current = text;
        },
        () => {},
      );
    };
    const onVisibility = () => document.visibilityState === 'hidden' && last(savers.current.saveOnExit);
    const onPageHide = () => last(savers.current.saveOnExit);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      clearTimeout(timer.current);
      last(savers.current.save);
    };
  }, []);

  return { value, setValue, status, flush };
}
