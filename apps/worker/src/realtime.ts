import { Injectable } from '@nestjs/common';
import type { MediaUpdate, ServerToClientEvents } from '@grand/contracts';
import { Emitter } from '@socket.io/redis-emitter';
import { Connections } from './connections.js';

/**
 * Sends real-time events to browsers through the API's Socket.IO servers: the Redis emitter
 * publishes on the same channels as the API's Redis adapter, which delivers to the room.
 */
@Injectable()
export class RealtimeEmitter {
  private readonly emitter: Emitter;

  constructor(connections: Connections) {
    this.emitter = new Emitter(connections.redis, { key: 'grand:io' });
  }

  /** To every open device of one person. */
  toUser<E extends keyof ServerToClientEvents>(userId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.emitter.to(`user:${userId}`).emit(event, ...args);
  }

  /** To the school's staff room: students never hear about drafts or uploads in progress. */
  media(update: MediaUpdate) {
    this.emitter.to(`school:${update.schoolId}:staff`).emit('media:updated', update);
  }
}
