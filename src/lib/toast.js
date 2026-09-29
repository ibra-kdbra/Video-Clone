import { useSyncExternalStore } from 'react';

/** Short confirmations ("Saved"), shown one at a time and announced to screen readers. */
let current = null;
let timer;
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

export function toast(message) {
  clearTimeout(timer);
  current = { id: Date.now(), message };
  emit();
  timer = setTimeout(() => {
    current = null;
    emit();
  }, 2600);
}

export const useToast = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
