import { useSyncExternalStore } from 'react';

/**
 * Short messages ("Saved", "Ada joined"), shown one at a time and announced to screen readers.
 * `tone`: 'success' (the default), 'info' for news that isn't a confirmation, 'error' for an
 * action that didn't go through.
 */
let current = null;
let timer;
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

export function toast(message, { tone = 'success' } = {}) {
  clearTimeout(timer);
  current = { id: Date.now(), message, tone };
  emit();
  // Longer messages stay up longer, so there's time to read them.
  timer = setTimeout(
    () => {
      current = null;
      emit();
    },
    Math.min(6000, 2600 + String(message).length * 30),
  );
}

export const useToast = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
