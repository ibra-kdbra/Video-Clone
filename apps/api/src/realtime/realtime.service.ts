import { Injectable } from '@nestjs/common';
import { type ClientToServerEvents, type Role, ROLE_RANK, type ServerToClientEvents } from '@grand/contracts';
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
  /** The school's instructors, admins and owner: events about drafts and uploads go only here. */
  schoolStaff: (schoolId: string) => `school:${schoolId}:staff`,
};

/** Whether a role belongs in the school's staff room. */
export const isStaff = (role: Role) => ROLE_RANK[role] >= ROLE_RANK.instructor;

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

  /** As emitToSchool, but only to the school's staff (instructors and above). */
  emitToSchoolStaff<E extends keyof ServerToClientEvents>(schoolId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.server?.to(rooms.schoolStaff(schoolId)).emit(event, ...args);
  }

  /** Tells the session's sockets why, then disconnects them. */
  endSession(sessionId: string, reason: 'logout' | 'revoked' | 'reuse_detected') {
    if (!this.server) return;
    this.server.to(rooms.session(sessionId)).emit('session:revoked', { reason });
    this.server.in(rooms.session(sessionId)).disconnectSockets();
  }

  /** Stops a person's sockets receiving a school's events (they left or were removed). */
  leaveSchool(userId: string, schoolId: string) {
    this.server?.in(rooms.user(userId)).socketsLeave([rooms.school(schoolId), rooms.schoolStaff(schoolId)]);
  }

  /**
   * After a role change, moves the person's sockets that follow the school into or out of its
   * staff room, on whichever API instance they're connected to.
   */
  async changeRole(userId: string, schoolId: string, role: Role) {
    if (!this.server) return;
    if (!isStaff(role)) {
      this.server.in(rooms.user(userId)).socketsLeave(rooms.schoolStaff(schoolId));
      return;
    }
    for (const socket of await this.server.in(rooms.user(userId)).fetchSockets()) {
      if (socket.rooms.has(rooms.school(schoolId))) socket.join(rooms.schoolStaff(schoolId));
    }
  }
}
