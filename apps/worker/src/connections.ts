import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { WORKER_CONFIG, type WorkerConfig } from './config.js';

/** The worker's Postgres pool and Redis connection, closed last on shutdown. */
@Injectable()
export class Connections implements OnApplicationShutdown {
  private readonly logger = new Logger(Connections.name);
  readonly sql: postgres.Sql;
  readonly redis: Redis;

  constructor(@Inject(WORKER_CONFIG) config: WorkerConfig) {
    this.sql = postgres(config.DATABASE_URL, {
      max: 5,
      onnotice: () => {},
      connection: { application_name: 'grand-worker', statement_timeout: 30_000 },
    });
    // BullMQ needs blocking commands to wait as long as they must, so no per-request retry limit.
    this.redis = new Redis(config.REDIS_URL, { connectionName: 'grand-worker', maxRetriesPerRequest: null });
    this.redis.on('error', (error) => this.logger.warn(`Redis: ${error.message}`));
  }

  /** A transaction acting for one school, so row-level security applies as it does in the API. */
  withSchool<T>(schoolId: string, work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => {
      await tx`select set_config('app.school_id', ${schoolId}, true)`;
      return work(tx);
    }) as Promise<T>;
  }

  async onApplicationShutdown() {
    await this.sql.end({ timeout: 5 });
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
