import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import type postgres from 'postgres';
import { Connections } from '../connections.js';
import { OUTBOX_QUEUE, type OutboxJob, QUEUE_PREFIX } from './queues.js';

const BATCH = 100;
/** A safety net: NOTIFY wakes the relay at once, and this catches anything a dropped listen missed. */
const POLL_MS = 5_000;

/**
 * Moves committed outbox events into the BullMQ queue. Postgres NOTIFY (sent on commit) wakes it
 * immediately; rows are claimed with FOR UPDATE SKIP LOCKED, so several workers can run side by
 * side without handing out the same event twice. The job id is derived from the event id, so even
 * if a crash lands between queueing and marking, re-queueing the event is a no-op.
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayService.name);
  readonly queue: Queue<OutboxJob>;
  private listener: postgres.ListenMeta | null = null;
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(private readonly connections: Connections) {
    this.queue = new Queue<OutboxJob>(OUTBOX_QUEUE, {
      connection: connections.redis,
      prefix: QUEUE_PREFIX,
      defaultJobOptions: {
        attempts: 8,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 86_400, count: 5_000 },
        removeOnFail: { age: 14 * 86_400 },
      },
    });
  }

  async onApplicationBootstrap() {
    this.listener = await this.connections.sql.listen('outbox', () => this.wake(), () => this.wake());
    this.timer = setInterval(() => this.wake(), POLL_MS);
    this.wake();
  }

  /** Starts a drain, or asks the running one to go round again. */
  wake() {
    if (this.stopped) return;
    if (this.draining) {
      this.again = true;
      return;
    }
    this.draining = this.drain()
      .catch((error: unknown) => this.logger.error(`Outbox relay failed: ${error instanceof Error ? error.message : error}`))
      .finally(() => {
        this.draining = null;
        if (this.again) {
          this.again = false;
          this.wake();
        }
      });
  }

  /** Publishes every unpublished event, a batch per transaction. Returns how many it published. */
  async drain(): Promise<void> {
    for (;;) {
      const published = await this.connections.sql.begin(async (tx) => {
        const rows = await tx<{ id: string; type: string }[]>`
          select id, type from outbox
          where published_at is null
          order by id
          limit ${BATCH}
          for update skip locked`;
        if (!rows.length) return 0;
        await this.queue.addBulk(
          rows.map((row) => ({ name: row.type, data: { outboxId: Number(row.id) }, opts: { jobId: `outbox-${row.id}` } })),
        );
        await tx`update outbox set published_at = now() where id in ${tx(rows.map((row) => row.id))}`;
        return rows.length;
      });
      if (published < BATCH || this.stopped) return;
    }
  }

  async onApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.listener?.unlisten();
    await this.draining;
    await this.queue.close();
  }
}
