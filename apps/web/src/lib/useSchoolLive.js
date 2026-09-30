import { useEffect, useRef, useState } from 'react';

import { useLiveSocket } from './live.js';

const EVENTS = ['school:member-joined', 'school:member-updated', 'school:member-removed'];
// A page that closes and opens again within this time (a quick back-and-forth, or React's
// development double render) keeps its subscription instead of dropping and renewing it.
const LINGER_MS = 1500;
// How long a re-subscription waits for the server to confirm the unsubscription before it.
const ACK_TIMEOUT_MS = 3000;

/**
 * Per connection and school: how many pages follow it, a pending unsubscription, and one still
 * being handled by the server. The server handles each message as it comes, in parallel, so an
 * "unsubscribe" sent just before a "subscribe" could finish last and quietly undo it; subscribing
 * waits for any unsubscription under way to be confirmed first.
 */
const registry = new WeakMap();

function entryFor(socket, slug) {
  let schools = registry.get(socket);
  if (!schools) registry.set(socket, (schools = new Map()));
  if (!schools.has(slug)) schools.set(slug, { holders: 0, timer: null, leaving: null });
  return schools.get(slug);
}

function unsubscribeLater(socket, slug, entry) {
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (entry.holders > 0 || !socket.connected) return;
    entry.leaving = new Promise((resolve) => {
      const done = setTimeout(resolve, ACK_TIMEOUT_MS);
      socket.emit('school:unsubscribe', { slug }, () => {
        clearTimeout(done);
        resolve();
      });
    }).finally(() => {
      entry.leaving = null;
    });
  }, LINGER_MS);
}

/**
 * Follows one school over the real-time connection: who's online (`online`, member ids, or null
 * while not connected), and member changes, passed to `onEvent(type, event)` with type 'joined',
 * 'updated' or 'removed'. It subscribes again after every reconnection, since the server forgets
 * a connection's subscriptions when it drops.
 */
export function useSchoolLive({ slug, schoolId, enabled = true, onEvent }) {
  const socket = useLiveSocket();
  const [online, setOnline] = useState(null);
  const handler = useRef(onEvent);

  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    if (!socket || !enabled || !schoolId) return undefined;
    const entry = entryFor(socket, slug);
    entry.holders += 1;
    clearTimeout(entry.timer);
    let active = true;

    const ours = (event) => event?.schoolId === schoolId;
    const subscribe = () =>
      Promise.resolve(entry.leaving).then(() => {
        // Emitting while disconnected would queue a second subscription for the next "connect".
        if (!active || !socket.connected) return;
        socket.emit('school:subscribe', { slug }, (ack) => {
          if (active && ack?.ok && ack.data?.schoolId === schoolId) setOnline(ack.data.online);
        });
      });
    const onPresence = (event) => ours(event) && setOnline(event.online);
    const onDisconnect = () => setOnline(null);
    const relays = EVENTS.map((name) => [name, (event) => ours(event) && handler.current?.(name.slice('school:member-'.length), event)]);

    subscribe();
    socket.on('connect', subscribe);
    socket.on('disconnect', onDisconnect);
    socket.on('school:presence', onPresence);
    for (const [name, relay] of relays) socket.on(name, relay);

    return () => {
      active = false;
      socket.off('connect', subscribe);
      socket.off('disconnect', onDisconnect);
      socket.off('school:presence', onPresence);
      for (const [name, relay] of relays) socket.off(name, relay);
      entry.holders -= 1;
      if (entry.holders === 0) unsubscribeLater(socket, slug, entry);
      setOnline(null);
    };
  }, [socket, slug, schoolId, enabled]);

  return { online };
}
