import { ROLE_RANK } from '@grand/contracts';

import { getSession } from '../lib/session.js';
import { server } from './server.js';

/**
 * The real-time connection, in the demo: there's no socket server, so this stands in for the
 * Socket.IO socket (lib/realtime.js) with the same `connect()` and the same events, carried from
 * the mock API through an in-page bus. The bell, toasts, presence and live cache updates work
 * unchanged, and so do Phase 3's rooms: a course's discussions (`course:watch`) and a live class's
 * room (`live:join`, with its chat, hands and presence, and the scripted classmates in it).
 * Acknowledgements come back a moment later, shaped as the API's gateway sends them. Nothing is
 * opened over the network.
 */

/** How long an acknowledgement takes, roughly a round trip. */
const ACK_MS = 30;

export function connect() {
  const userId = getSession().user?.id ?? null;
  const handlers = new Map();
  const rooms = new Map();
  const watched = new Set();
  const classes = new Set();
  const answer = (ack, result, delay = ACK_MS) => setTimeout(() => ack?.(result), delay);

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
      if (!socket.connected) return socket;
      const live = server.realtime;
      if (event === 'school:subscribe') {
        const { role, ...result } = server.presence(userId, input?.slug);
        if (result.ok) rooms.set(result.data.schoolId, role);
        answer(ack, result);
      } else if (event === 'school:unsubscribe') {
        const school = server.db.find('schools', (row) => row.slug === input?.slug);
        if (school) rooms.delete(school.id);
        answer(ack, { ok: true, data: undefined }, 15);
      } else if (event === 'course:watch') {
        const result = live.watchCourse(userId, input);
        if (result.ok) watched.add(input.courseId);
        answer(ack, result);
      } else if (event === 'course:unwatch') {
        const result = live.unwatchCourse(userId, input);
        if (result.ok) watched.delete(input.courseId);
        answer(ack, result, 15);
      } else if (event === 'live:join') {
        // In the room before the join is answered, so the presence it sends arrives here too.
        const sessionId = typeof input?.sessionId === 'string' ? input.sessionId : null;
        const already = Boolean(sessionId) && classes.has(sessionId);
        if (sessionId) classes.add(sessionId);
        const result = live.join(userId, input);
        if (!result.ok && sessionId && !already) classes.delete(sessionId);
        answer(ack, result);
      } else if (event === 'live:leave') {
        const result = live.leave(userId, input);
        if (result.ok) classes.delete(input.sessionId);
        answer(ack, result, 15);
      } else if (event === 'live:message') {
        answer(ack, live.message(userId, input));
      } else if (event === 'live:hand') {
        answer(ack, live.hand(userId, input));
      }
      return socket;
    },
    /** As Socket.IO's: the acknowledgement, as a promise. */
    emitWithAck(event, input) {
      return new Promise((resolve) => socket.emit(event, input, resolve));
    },
  };

  const stop = server.subscribe((message) => {
    if (!socket.connected) return;
    if (message.userId && message.userId !== userId) return;
    if (message.schoolId) {
      if (!rooms.has(message.schoolId)) return;
      if (message.staff && ROLE_RANK[rooms.get(message.schoolId)] < ROLE_RANK.instructor) return;
    }
    if (message.course && !watched.has(message.course)) return;
    if (message.live && !classes.has(message.live)) return;
    for (const handler of [...(handlers.get(message.event) ?? [])]) handler(message.payload);
  });

  return {
    socket,
    close() {
      stop();
      // Out of every class's room, as when a socket disconnects: the classmates' script stops.
      server.realtime.disconnected(userId, [...classes]);
      socket.connected = false;
      socket.active = false;
      handlers.clear();
      rooms.clear();
      watched.clear();
      classes.clear();
    },
  };
}
