import { Injectable } from '@nestjs/common';
import type { ClientToServerEvents, ServerToClientEvents } from '@grand/contracts';
import type { Server } from 'socket.io';

export interface SocketData {
  userId: string;
  sessionId: string;
  /** Schools this connection subscribed to, by id. */
  schools: Set<string>;
  /** The connection's commands, run one after another in the order they arrived. */
  queue: Promise<unknown>;
}

export type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export const rooms = {
  user: (userId: string) => `user:${userId}`,
  session: (sessionId: string) => `session:${sessionId}`,
  school: (schoolId: string) => `school:${schoolId}`,
};

/**
 * How the rest of the API talks to connected browsers. Rooms are shared across API instances
 * through the Redis adapter, so an event emitted here reaches sockets connected anywhere.
 */
@Injectable()
export class RealtimeService {
  private server: RealtimeServer | null = null;

  attach(server: RealtimeServer) {
    this.server = server;
  }

  emitToSchool<E extends keyof ServerToClientEvents>(schoolId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.server?.to(rooms.school(schoolId)).emit(event, ...args);
  }

  /** Tells the session's sockets why, then disconnects them. */
  endSession(sessionId: string, reason: 'logout' | 'revoked' | 'reuse_detected') {
    if (!this.server) return;
    this.server.to(rooms.session(sessionId)).emit('session:revoked', { reason });
    this.server.in(rooms.session(sessionId)).disconnectSockets();
  }

  /** Stops a person's sockets receiving a school's events (they left or were removed). */
  leaveSchool(userId: string, schoolId: string) {
    this.server?.in(rooms.user(userId)).socketsLeave(rooms.school(schoolId));
  }
}
