import { Injectable } from '@nestjs/common';
import { type ClientToServerEvents, type Role, ROLE_RANK, type ServerToClientEvents } from '@grand/contracts';
import type { Server } from 'socket.io';

export interface SocketData {
  userId: string;
  sessionId: string;
  /** Schools this connection subscribed to, by id. */
  schools: Set<string>;
  /** Live classes this connection is in, by id. */
  live: Set<string>;
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
  /** People watching a course's discussions (its editors and enrolled students). */
  course: (courseId: string) => `course:${courseId}`,
  /** People in a live class's room: its chat, presence and status. */
  live: (sessionId: string) => `live:${sessionId}`,
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

  /** To every open device of one person. */
  emitToUser<E extends keyof ServerToClientEvents>(userId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.server?.to(rooms.user(userId)).emit(event, ...args);
  }

  /** To everyone watching a course's discussions. */
  emitToCourse<E extends keyof ServerToClientEvents>(courseId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.server?.to(rooms.course(courseId)).emit(event, ...args);
  }

  /** To everyone in a live class's room. */
  emitToLive<E extends keyof ServerToClientEvents>(sessionId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.server?.to(rooms.live(sessionId)).emit(event, ...args);
  }

  /** The sockets in a room, across every API instance; empty when the server isn't running. */
  async socketsIn(room: string) {
    if (!this.server) return [];
    return this.server.in(room).fetchSockets();
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

  /** Takes a person's sockets out of rooms (a course they can no longer read, a class they left). */
  leaveRooms(userId: string, names: string[]) {
    this.server?.in(rooms.user(userId)).socketsLeave(names);
  }

  /**
   * After a role change, puts the person's devices in the school's staff room, or takes them out.
   * A broadcast, like leaveSchool: it doesn't wait on every API instance to answer, so an instance
   * that's restarting can't make it fail. (Devices not following the school join too; they belong
   * to staff all the same, and the app ignores schools it isn't showing.)
   */
  changeRole(userId: string, schoolId: string, role: Role) {
    if (!this.server) return;
    const people = this.server.in(rooms.user(userId));
    if (isStaff(role)) people.socketsJoin(rooms.schoolStaff(schoolId));
    else people.socketsLeave(rooms.schoolStaff(schoolId));
  }
}
