import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Connections } from '../connections.js';
import { SubmissionFilesService } from '../files/submission-files.service.js';
import { MediaService } from '../media/media.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MAINTENANCE_QUEUE, QUEUE_PREFIX } from './queues.js';

/**
 * Scheduled work, through BullMQ so only one worker runs each job however many are up:
 * - nightly clean-up: expired refresh tokens, long-ended sessions, handled outbox events, video and
 *   file uploads abandoned for more than a day, and old notifications (read ones after 90 days,
 *   others after 180)
 * - every minute, live classes: "starting soon" reminders, and closing classes left running two
 *   hours past their end (or never started)
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
    private readonly notifications: NotificationsService,
  ) {
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: connections.redis, prefix: QUEUE_PREFIX });
  }

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler('nightly-cleanup', { pattern: '17 3 * * *', tz: 'UTC' }, { name: 'cleanup', opts: { removeOnComplete: 30, removeOnFail: 30 } });
    await this.queue.upsertJobScheduler('live-classes', { every: 60_000 }, { name: 'live', opts: { removeOnComplete: 10, removeOnFail: 30 } });
    this.worker = new Worker(MAINTENANCE_QUEUE, (job) => (job.name === 'live' ? this.liveClasses() : this.cleanup()), {
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

  /** Reminders for classes starting within 15 minutes, once each; then tidies classes left behind. */
  async liveClasses() {
    const { sql } = this.connections;
    const due = await sql<{ id: string; school_id: string }[]>`select * from app.claim_live_reminders(interval '15 minutes')`;
    for (const session of due) {
      await this.notifications.liveReminder(session.school_id, session.id).catch((error: unknown) => this.logger.warn(`Live reminder for ${session.id}: ${(error as Error).message}`));
    }
    const [{ closed } = { closed: 0 }] = await sql<{ closed: number }[]>`select app.close_stale_live(interval '2 hours') as closed`;
    if (due.length || closed) this.logger.log(`Live classes: ${due.length} reminded, ${closed} closed`);
    return { reminded: due.length, closed };
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue.close();
  }
}
