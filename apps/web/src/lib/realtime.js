import { io } from 'socket.io-client';
import { REALTIME_PATH } from '@grand/contracts';

import { apiFetch } from './session.js';

/**
 * Opens the Socket.IO connection (loaded lazily, see live.js). Every attempt, reconnections
 * included, first fetches a fresh single-use ticket over the signed-in API, so the socket itself
 * never carries the access token. Locally it goes through the dev server's proxy on this origin;
 * production builds connect to VITE_REALTIME_ORIGIN when it's set, since Netlify's proxy doesn't
 * carry WebSockets.
 */
export function connect({ onRevoked }) {
  const origin = import.meta.env.VITE_REALTIME_ORIGIN;
  const options = {
    path: REALTIME_PATH,
    transports: ['websocket'],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    auth: (send) => {
      apiFetch('/realtime/ticket', { method: 'POST' }).then(
        ({ ticket }) => send({ ticket }),
        () => send({}),
      );
    },
  };
  const socket = origin ? io(origin, options) : io(options);

  // When the server itself turns the connection down (no valid ticket, say, after a hiccup),
  // Socket.IO doesn't try again by itself; this does, backing off up to 30 seconds.
  let attempts = 0;
  let retry;
  socket.on('connect', () => {
    attempts = 0;
  });
  socket.on('connect_error', () => {
    if (socket.active) return;
    clearTimeout(retry);
    retry = setTimeout(() => socket.connect(), Math.min(30_000, 1000 * 2 ** attempts++));
  });
  socket.on('session:revoked', (event) => onRevoked(event?.reason ?? 'revoked'));

  return {
    socket,
    close() {
      clearTimeout(retry);
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
