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
import { type Ack, type PresenceUpdate, subscribeSchoolInput } from '@grand/contracts';
import type { Socket } from 'socket.io';
import { SchoolsService } from '../schools/schools.service.js';
import { type RealtimeServer, RealtimeService, rooms, type SocketData } from './realtime.service.js';
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
  ) {}

  afterInit(server: RealtimeServer) {
    this.realtime.attach(server);
    // Runs before a connection is accepted: no valid ticket, no connection.
    server.use((socket, next) => {
      this.tickets.redeem(socket.handshake.auth?.ticket).then(
        (auth) => {
          if (!auth) return next(Object.assign(new Error('unauthenticated'), { data: { code: 'unauthenticated' } }));
          socket.data = { ...auth, schools: new Set(), queue: Promise.resolve() };
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
      await socket.join(rooms.school(school.id));
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
        await this.broadcastPresence(school.id);
      }
      return { ok: true, data: undefined };
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
