import type { INestApplicationContext } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { REALTIME_PATH } from '@grand/contracts';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, ServerOptions } from 'socket.io';
import { AppConfig } from '../config/app-config.js';
import { RedisService } from '../redis/redis.service.js';

/**
 * Socket.IO on the API's own port, WebSocket transport only, limited to the web app's origins, and
 * backed by Redis so rooms and broadcasts work across any number of API instances.
 */
export class RealtimeIoAdapter extends IoAdapter {
  private readonly config: AppConfig;
  private readonly redis: RedisService;
  private readonly pubsub: Redis[] = [];

  constructor(app: INestApplicationContext) {
    super(app);
    this.config = app.get(AppConfig);
    this.redis = app.get(RedisService);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const { webOrigins } = this.config;
    const settings: Partial<ServerOptions> = {
      ...options,
      path: REALTIME_PATH,
      transports: ['websocket'],
      serveClient: false,
      // Clients only send small commands; anything bigger is dropped with the connection.
      maxHttpBufferSize: 16 * 1024,
      pingInterval: 25_000,
      pingTimeout: 20_000,
      connectTimeout: 10_000,
      cors: { origin: webOrigins, credentials: false },
      // Refuses WebSocket upgrades from other sites' pages (cross-site WebSocket hijacking).
      allowRequest: (request, callback) => callback(null, webOrigins.includes(request.headers.origin ?? '')),
    };
    const server: Server = super.createIOServer(port, settings as ServerOptions);
    const pub = this.redis.duplicate('io-pub');
    const sub = this.redis.duplicate('io-sub');
    this.pubsub.push(pub, sub);
    server.adapter(createAdapter(pub, sub, { key: 'grand:io' }));
    return server;
  }

  /**
   * Closes this instance's sockets and leaves the Redis channels while Redis is still connected.
   * The HTTP server itself is closed by Fastify.
   */
  override async close(server: Server): Promise<void> {
    server.local.disconnectSockets(true);
    await server.of('/').adapter.close();
    server.engine.close();
    await Promise.all(this.pubsub.splice(0).map((connection) => connection.quit().catch(() => connection.disconnect())));
  }
}
