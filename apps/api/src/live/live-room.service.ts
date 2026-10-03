import { Injectable, Logger } from '@nestjs/common';
import type { Ack, LiveAttendee, LiveMessage, LiveRoomState } from '@grand/contracts';
import { DatabaseService } from '../database/database.service.js';
import { liveMessages } from '../database/schema.js';
import { RateLimiterService } from '../rate-limit/rate-limiter.service.js';
import { RealtimeService, rooms } from '../realtime/realtime.service.js';
import { roomOpen, type Viewing, WAITING_ROOM_MS } from './live-access.js';
import { LiveStore } from './live-store.service.js';

/** The part of a socket the class room needs. */
export interface RoomSocket {
  data: { userId: string; live: Set<string> };
  join(room: string): void | Promise<void>;
  leave(room: string): void | Promise<void>;
}

const refuse = (code: string, message: string): Ack<never> => ({ ok: false, error: { code, message } });

/** Chat: at most this many messages per person per window. */
const CHAT_LIMIT = 8;
const CHAT_WINDOW_MS = 10_000;

/**
 * A live class's room on the live connection: coming in and out, the chat, raised hands, and who's
 * there. Whatever carries the video (LiveKit, YouTube, a meeting link), this is the same.
 */
@Injectable()
export class LiveRoomService {
  private readonly logger = new Logger(LiveRoomService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly store: LiveStore,
    private readonly realtime: RealtimeService,
    private readonly limiter: RateLimiterService,
  ) {}

  async join(socket: RoomSocket, sessionId: string): Promise<Ack<LiveRoomState>> {
    const found = await this.store.byId(socket.data.userId, sessionId);
    if (!found) return refuse('not_found', "This class doesn't exist.");
    const { viewing, session } = found;
    if (!viewing.canJoin) return refuse('enrollment_required', 'Enroll in the course to join its classes.');
    if (!roomOpen(session, viewing.host)) {
      return session.status === 'scheduled'
        ? refuse('conflict', `The waiting room opens ${WAITING_ROOM_MS / 60_000} minutes before the class.`)
        : refuse('conflict', session.status === 'cancelled' ? 'This class was cancelled.' : 'This class is over.');
    }
    await socket.join(rooms.live(sessionId));
    socket.data.live.add(sessionId);
    const state = await this.db.transaction({ userId: viewing.userId, schoolId: viewing.school.id }, async (tx) => {
      await this.store.recordAttendance(tx, viewing, sessionId);
      return {
        session: await this.store.describe(tx, viewing, session),
        messages: await this.store.messages(tx, viewing, sessionId, { limit: 50 }),
      };
    });
    const attendees = await this.broadcastPresence(sessionId, viewing);
    return { ok: true, data: { ...state, attendees } };
  }

  async leave(socket: RoomSocket, sessionId: string): Promise<Ack> {
    if (!socket.data.live.delete(sessionId)) return { ok: true, data: undefined };
    await socket.leave(rooms.live(sessionId));
    await this.afterLeaving(socket.data.userId, sessionId);
    return { ok: true, data: undefined };
  }

  /** After a disconnect: the rooms the socket was in. */
  async disconnected(userId: string, sessionIds: Iterable<string>) {
    for (const sessionId of sessionIds) {
      await this.afterLeaving(userId, sessionId).catch((error: unknown) => this.logger.warn({ err: error }, 'Live presence update failed'));
    }
  }

  async message(socket: RoomSocket, sessionId: string, body: string): Promise<Ack<LiveMessage>> {
    if (!socket.data.live.has(sessionId)) return refuse('forbidden', 'Join the class first.');
    const found = await this.store.byId(socket.data.userId, sessionId);
    if (!found || !found.viewing.canJoin) return refuse('forbidden', "You can't post in this class.");
    const { viewing, session } = found;
    if (session.status !== 'scheduled' && session.status !== 'live') return refuse('conflict', 'This class is over.');
    const limit = await this.limiter.consume(`live-chat:${viewing.userId}`, CHAT_LIMIT, CHAT_WINDOW_MS);
    if (!limit.allowed) return refuse('rate_limited', 'Slow down a little: wait a moment before sending more.');
    const message = await this.db.transaction({ userId: viewing.userId, schoolId: viewing.school.id }, async (tx) => {
      const [row] = await tx.insert(liveMessages).values({ schoolId: viewing.school.id, sessionId, userId: viewing.userId, body }).returning();
      const [shown] = await this.store.toMessages(tx, viewing, [row!]);
      return shown!;
    });
    this.realtime.emitToLive(sessionId, 'live:message', message);
    return { ok: true, data: message };
  }

  /** A student raises or lowers their hand, while the class is on. */
  async hand(socket: RoomSocket, sessionId: string, raised: boolean): Promise<Ack> {
    if (!socket.data.live.has(sessionId)) return refuse('forbidden', 'Join the class first.');
    const found = await this.store.byId(socket.data.userId, sessionId);
    if (!found) return refuse('not_found', "This class doesn't exist.");
    if (found.session.status !== 'live') return refuse('conflict', "Hands go up once the class has started.");
    if (found.viewing.host) return refuse('conflict', 'Hosts don’t need to raise a hand.');
    await this.store.setFlag(sessionId, 'hands', socket.data.userId, raised);
    await this.broadcastPresence(sessionId, found.viewing);
    return { ok: true, data: undefined };
  }

  private async afterLeaving(userId: string, sessionId: string) {
    const found = await this.store.byId(userId, sessionId);
    if (!found) return;
    // Last seen now.
    await this.db.transaction({ userId, schoolId: found.viewing.school.id }, (tx) => this.store.recordAttendance(tx, found.viewing, sessionId));
    // Gone from the room: a raised hand goes down.
    const still = (await this.realtime.socketsIn(rooms.live(sessionId))).some((other) => other.data.userId === userId);
    if (!still) await this.store.setFlag(sessionId, 'hands', userId, false);
    await this.broadcastPresence(sessionId, found.viewing);
  }

  /** Who's in the class now, across every API instance, with hands and speakers; sent to the room. */
  async broadcastPresence(sessionId: string, viewing: Viewing): Promise<LiveAttendee[]> {
    const sockets = await this.realtime.socketsIn(rooms.live(sessionId));
    const userIds = [...new Set(sockets.map((socket) => socket.data.userId))];
    const [people, flags] = await Promise.all([
      this.db.transaction({ userId: viewing.userId, schoolId: viewing.school.id }, (tx) => this.store.people(tx, viewing, userIds)),
      this.store.flags(sessionId),
    ]);
    const attendees = userIds
      .filter((id) => people.has(id))
      .map((id) => ({ userId: id, name: people.get(id)!.name, host: people.get(id)!.host, handRaised: flags.hands.has(id), speaker: flags.speakers.has(id) }))
      .sort((a, b) => Number(b.host) - Number(a.host) || a.name.localeCompare(b.name));
    this.realtime.emitToLive(sessionId, 'live:presence', { sessionId, attendees });
    return attendees;
  }
}
