import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/app-config.js';

/** One shared Redis connection for commands (rate limits, tickets, revoked sessions). */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: AppConfig) {
    this.client = new Redis(config.redisUrl, {
      connectionName: 'grand-api',
      maxRetriesPerRequest: 2,
      enableAutoPipelining: true,
    });
    this.client.on('error', (error) => this.logger.warn(`Redis: ${error.message}`));
  }

  /** A separate connection (for pub/sub). Whoever asks for it closes it. */
  duplicate(name: string): Redis {
    // No auto-pipelining: it would defer commands such as UNSUBSCRIBE past a QUIT sent right after.
    const connection = this.client.duplicate({ connectionName: `grand-api:${name}`, enableAutoPipelining: false });
    connection.on('error', (error) => this.logger.warn(`Redis (${name}): ${error.message}`));
    return connection;
  }

  async ping() {
    await this.client.ping();
  }

  async onApplicationShutdown() {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
