import { useEffect, useState } from 'react';

/** Resolves when the browser has a quiet moment (or after `timeout` ms at the latest). */
export const whenIdle = (timeout = 2000) =>
  new Promise((resolve) => {
    if (window.requestIdleCallback) window.requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, 200);
  });

/**
 * False on the first render, true once the browser has a quiet moment. For content below the
 * screen: rendering it after the first paint keeps that paint fast.
 */
export function useIdle(timeout = 1500) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(() => setIdle(true), { timeout });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(() => setIdle(true), 200);
    return () => clearTimeout(id);
  }, [timeout]);
  return idle;
}
