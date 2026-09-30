import { useSyncExternalStore } from 'react';

/**
 * A tiny persisted store: state lives in localStorage, every component reading it re-renders on
 * change, and other open tabs follow along. `read` validates what comes back from storage, which
 * is treated as untrusted input (it can be edited, or left by an older version of the app).
 */
export function createStore(key, read, fallback) {
  const load = () => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : read(JSON.parse(raw));
    } catch {
      return fallback;
    }
  };

  let state = load();
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener());

  if (typeof window !== 'undefined')
    window.addEventListener('storage', (event) => {
      if (event.key !== key && event.key !== null) return;
      state = load();
      emit();
    });

  return {
    get: () => state,
    set(next) {
      state = typeof next === 'function' ? next(state) : next;
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        // Storage full or blocked (private mode): keep the in-memory state.
      }
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const useStore = (store) => useSyncExternalStore(store.subscribe, store.get, store.get);
