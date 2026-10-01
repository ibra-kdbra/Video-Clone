import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Connections } from '../connections.js';
import { SubmissionFilesService } from '../files/submission-files.service.js';
import { MediaService } from '../media/media.service.js';
import { MAINTENANCE_QUEUE, QUEUE_PREFIX } from './queues.js';

/**
 * Nightly clean-up, scheduled through BullMQ so only one worker runs it however many are up:
 * expired refresh tokens, long-ended sessions, handled outbox events, video and file uploads
 * abandoned for more than a day, and old notifications (read ones after 90 days, others after 180).
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceService.name);
  private readonly queue: Queue;
  private worker: Worker | null = null;

  constructor(
    private readonly connections: Connections,
    private readonly media: MediaService,
    private readonly files: SubmissionFilesService,
  ) {
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: connections.redis, prefix: QUEUE_PREFIX });
  }

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler('nightly-cleanup', { pattern: '17 3 * * *', tz: 'UTC' }, { name: 'cleanup', opts: { removeOnComplete: 30, removeOnFail: 30 } });
    this.worker = new Worker(MAINTENANCE_QUEUE, () => this.cleanup(), {
      connection: this.connections.redis.duplicate({ maxRetriesPerRequest: null }),
      prefix: QUEUE_PREFIX,
      concurrency: 1,
    });
    this.worker.on('error', (error) => this.logger.error(`Worker: ${error.message}`));
  }

  async cleanup() {
    const { sql } = this.connections;
    const tokens = await sql`delete from refresh_tokens where expires_at < now() - interval '7 days'`;
    const sessions = await sql`
      delete from sessions
      where revoked_at < now() - interval '30 days' or expires_at < now() - interval '30 days'`;
    const events = await sql`delete from outbox where processed_at < now() - interval '14 days'`;
    const abandonedUploads = await this.media.abandonStaleUploads();
    const abandonedFiles = await this.files.abandonStale();
    const [{ pruned } = { pruned: 0 }] = await sql<{ pruned: number }[]>`select app.prune_notifications(interval '90 days') as pruned`;
    const summary = { refreshTokens: tokens.count, sessions: sessions.count, outboxEvents: events.count, abandonedUploads, abandonedFiles, notifications: pruned };
    this.logger.log(`Clean-up removed ${JSON.stringify(summary)}`);
    return summary;
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue.close();
  }
}
