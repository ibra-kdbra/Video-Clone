import { Injectable } from '@nestjs/common';
import type { MediaUpdate } from '@grand/contracts';
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

  media(update: MediaUpdate) {
    this.emitter.to(`school:${update.schoolId}`).emit('media:updated', update);
  }
}
