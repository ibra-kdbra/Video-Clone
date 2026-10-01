import { ROLE_RANK } from '@grand/contracts';

import { getSession } from '../lib/session.js';
import { server } from './server.js';

/**
 * The real-time connection, in the demo: there's no socket server, so this stands in for the
 * Socket.IO socket (lib/realtime.js) with the same `connect()` and the same events, carried from
 * the mock API through an in-page bus. The bell, toasts, presence and live cache updates work
 * unchanged. Nothing is opened over the network.
 */
export function connect() {
  const userId = getSession().user?.id ?? null;
  const handlers = new Map();
  const rooms = new Map();

  const socket = {
    connected: true,
    active: true,
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return socket;
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler);
      return socket;
    },
    emit(event, input, ack) {
      if (event === 'school:subscribe') {
        const { role, ...result } = server.presence(userId, input?.slug);
        if (result.ok) rooms.set(result.data.schoolId, role);
        setTimeout(() => ack?.(result), 30);
      } else if (event === 'school:unsubscribe') {
        const school = server.db.find('schools', (row) => row.slug === input?.slug);
        if (school) rooms.delete(school.id);
        setTimeout(() => ack?.({ ok: true, data: undefined }), 15);
      }
      return socket;
    },
  };

  const stop = server.subscribe((message) => {
    if (!socket.connected) return;
    if (message.userId && message.userId !== userId) return;
    if (message.schoolId) {
      if (!rooms.has(message.schoolId)) return;
      if (message.staff && ROLE_RANK[rooms.get(message.schoolId)] < ROLE_RANK.instructor) return;
    }
    for (const handler of [...(handlers.get(message.event) ?? [])]) handler(message.payload);
  });

  return {
    socket,
    close() {
      stop();
      socket.connected = false;
      socket.active = false;
      handlers.clear();
      rooms.clear();
    },
  };
}
