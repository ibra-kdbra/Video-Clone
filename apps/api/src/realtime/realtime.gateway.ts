import { type BeforeApplicationShutdown, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  type Ack,
  type LiveMessage,
  type LiveRoomState,
  liveHandInput,
  liveJoinInput,
  liveMessageInput,
  type PresenceUpdate,
  subscribeSchoolInput,
  watchCourseInput,
} from '@grand/contracts';
import type { Socket } from 'socket.io';
import { LiveRoomService } from '../live/live-room.service.js';
import { LiveStore } from '../live/live-store.service.js';
import { SchoolsService } from '../schools/schools.service.js';
import { isStaff, type RealtimeServer, RealtimeService, rooms, type SocketData } from './realtime.service.js';
import { TicketService } from './ticket.service.js';
import { TokenBucket } from './token-bucket.js';

type ClientSocket = Socket<Record<string, never>, Record<string, never>, Record<string, never>, SocketData>;

const refuse = (code: string, message: string): Ack<never> => ({ ok: false, error: { code, message } });

/**
 * Socket.IO runs a connection's handlers concurrently, so a quick unsubscribe-then-subscribe could
 * finish in the wrong order and leave the socket out of the room. Each connection's commands run
 * one after another instead.
 */
function inOrder<T>(socket: ClientSocket, task: () => Promise<T>): Promise<T> {
  const run = socket.data.queue.then(task, task);
  socket.data.queue = run.catch(() => undefined);
  return run;
}

@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, BeforeApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  private closing = false;
  @WebSocketServer() private readonly server: RealtimeServer;

  constructor(
    private readonly tickets: TicketService,
    private readonly realtime: RealtimeService,
    private readonly schools: SchoolsService,
    private readonly liveRoom: LiveRoomService,
    private readonly liveStore: LiveStore,
  ) {}

  afterInit(server: RealtimeServer) {
    this.realtime.attach(server);
    // Runs before a connection is accepted: no valid ticket, no connection.
    server.use((socket, next) => {
      this.tickets.redeem(socket.handshake.auth?.ticket).then(
        (auth) => {
          if (!auth) return next(Object.assign(new Error('unauthenticated'), { data: { code: 'unauthenticated' } }));
          socket.data = { ...auth, schools: new Set(), live: new Set(), queue: Promise.resolve() };
          next();
        },
        (error: unknown) => {
          this.logger.error({ err: error }, 'Ticket check failed');
          next(new Error('unavailable'));
        },
      );
    });
  }

  async handleConnection(socket: ClientSocket) {
    if (!socket.data?.userId) return;
    await socket.join([rooms.user(socket.data.userId), rooms.session(socket.data.sessionId)]);
    // 20 events at once, 5 a second after that; a client that keeps going over is dropped.
    const budget = new TokenBucket(20, 5);
    let strikes = 0;
    socket.use((_packet, next) => {
      if (budget.take()) return next();
      if (++strikes >= 20) socket.disconnect(true);
      next(new Error('rate_limited'));
    });
  }

  async handleDisconnect(socket: ClientSocket) {
    // Everyone disconnects at shutdown; there's nobody left to tell, and Redis is closing.
    if (this.closing) return;
    for (const schoolId of socket.data?.schools ?? []) {
      await this.broadcastPresence(schoolId).catch((error: unknown) => this.logger.warn({ err: error }, 'Presence update failed'));
    }
    if (socket.data?.live?.size) await this.liveRoom.disconnected(socket.data.userId, socket.data.live);
  }

  beforeApplicationShutdown() {
    this.closing = true;
  }

  @SubscribeMessage('school:subscribe')
  subscribe(@ConnectedSocket() socket: ClientSocket, @MessageBody() body: unknown): Promise<Ack<PresenceUpdate>> {
    return inOrder(socket, async () => {
      const input = subscribeSchoolInput.safeParse(body);
      if (!input.success) return refuse('validation_failed', 'Unknown school.');
      const school = await this.schools.access(socket.data.userId, input.data.slug);
      if (!school?.role) return refuse('forbidden', "You're not a member of this school.");
      await socket.join(isStaff(school.role) ? [rooms.school(school.id), rooms.schoolStaff(school.id)] : rooms.school(school.id));
      socket.data.schools.add(school.id);
      return { ok: true, data: await this.broadcastPresence(school.id) };
    });
  }

  @SubscribeMessage('school:unsubscribe')
  unsubscribe(@ConnectedSocket() socket: ClientSocket, @MessageBody() body: unknown): Promise<Ack> {
    return inOrder(socket, async () => {
      const input = subscribeSchoolInput.safeParse(body);
      if (!input.success) return refuse('validation_failed', 'Unknown school.');
      const school = await this.schools.access(socket.data.userId, input.data.slug);
      if (school && socket.data.schools.delete(school.id)) {
        await socket.leave(rooms.school(school.id));
        await socket.leave(rooms.schoolStaff(school.id));
        await this.broadcastPresence(school.id);
      }
      return { ok: true, data: undefined };
    });
  }

  /** Follow a course's discussions: its editors and enrolled students. */
  @SubscribeMessage('course:watch')
  watchCourse(@ConnectedSocket() socket: ClientSocket, @MessageBody() body: unknown): Promise<Ack> {
    return inOrder(socket, async () => {
      const input = watchCourseInput.safeParse(body);
      if (!input.success) return refuse('validation_failed', 'Unknown course.');
      const viewing = await this.liveStore.courseById(socket.data.userId, input.data.courseId);
      if (!viewing) return refuse('not_found', "This course doesn't exist.");
      if (!viewing.canJoin) return refuse('enrollment_required', 'Enroll in the course to follow its discussions.');
      await socket.join(rooms.course(input.data.courseId));
      return { ok: true, data: undefined };
    });
  }

  @SubscribeMessage('course:unwatch')
  unwatchCourse(@ConnectedSocket() socket: ClientSocket, @MessageBody() body: unknown): Promise<Ack> {
    return inOrder(socket, async () => {
      const input = watchCourseInput.safeParse(body);
      if (!input.success) return refuse('validation_failed', 'Unknown course.');
      await socket.leave(rooms.course(input.data.courseId));
      return { ok: true, data: undefined };
    });
  }

  @SubscribeMessage('live:join')
  joinLive(@ConnectedSocket() socket: ClientSocket, @MessageBody() body: unknown): Promise<Ack<LiveRoomState>> {
    return inOrder(socket, async () => {
      const input = liveJoinInput.safeParse(body);
      if (!input.success) return refuse('validation_failed', 'Unknown class.');
      return this.liveRoom.join(socket, input.data.sessionId);
    });
  }

  @SubscribeMessage('live:leave')
  leaveLive(@ConnectedSocket() socket: ClientSocket, @MessageBody() body: unknown): Promise<Ack> {
    return inOrder(socket, async () => {
      const input = liveJoinInput.safeParse(body);
      if (!input.success) return refuse('validation_failed', 'Unknown class.');
      return this.liveRoom.leave(socket, input.data.sessionId);
    });
  }

  @SubscribeMessage('live:message')
  liveMessage(@ConnectedSocket() socket: ClientSocket, @MessageBody() body: unknown): Promise<Ack<LiveMessage>> {
    return inOrder(socket, async () => {
      const input = liveMessageInput.safeParse(body);
      if (!input.success) return refuse('validation_failed', input.error.issues[0]?.message ?? 'Write a message.');
      return this.liveRoom.message(socket, input.data.sessionId, input.data.body);
    });
  }

  @SubscribeMessage('live:hand')
  liveHand(@ConnectedSocket() socket: ClientSocket, @MessageBody() body: unknown): Promise<Ack> {
    return inOrder(socket, async () => {
      const input = liveHandInput.safeParse(body);
      if (!input.success) return refuse('validation_failed', 'Unknown class.');
      return this.liveRoom.hand(socket, input.data.sessionId, input.data.raised);
    });
  }

  /** Who is connected to the school right now, across every API instance. */
  private async broadcastPresence(schoolId: string): Promise<PresenceUpdate> {
    const sockets = await this.server.in(rooms.school(schoolId)).fetchSockets();
    const update = { schoolId, online: [...new Set(sockets.map((socket) => socket.data.userId))] };
    this.server.to(rooms.school(schoolId)).emit('school:presence', update);
    return update;
  }
}
