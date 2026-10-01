import { useSyncExternalStore } from 'react';

import { DEMO } from './demo.js';
import { endSessionLocally } from './session.js';
import { whenIdle } from './useIdle.js';

/**
 * The real-time connection, open while someone is signed in. The Socket.IO client is its own chunk
 * (realtime.js), loaded once the browser is idle after sign-in, so visitors who never sign in
 * never download it. In the demo there's no socket server: the mock API's in-page stand-in
 * (src/demo/socket.js) carries the same events instead.
 */
let connection = null;
// Bumped by every start and stop, so a connection that finishes loading after a sign-out is dropped.
let generation = 0;
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

export function startLive() {
  const mine = ++generation;
  whenIdle()
    .then(() => (DEMO ? import('../demo/socket.js') : import('./realtime.js')))
    .then(({ connect }) => {
      if (mine !== generation) return;
      connection = connect({ onRevoked: (reason) => endSessionLocally(reason) });
      emit();
    })
    .catch(() => {
      // No live updates this time (the chunk failed to load); everything else still works.
    });
}

export function stopLive() {
  generation += 1;
  if (!connection) return;
  connection.close();
  connection = null;
  emit();
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The Socket.IO socket while signed in (null before it has loaded, and when signed out). */
export const useLiveSocket = () => useSyncExternalStore(subscribe, () => connection?.socket ?? null, () => null);
