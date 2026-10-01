import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Job, UnrecoverableError, Worker } from 'bullmq';
import { WORKER_CONFIG, type WorkerConfig } from '../config.js';
import { Connections } from '../connections.js';
import { QUEUE_PREFIX } from '../jobs/queues.js';
import { UnusableVideoError } from './ffmpeg.js';
import { MEDIA_QUEUE, type TranscodeJob } from './media.queue.js';
import { MediaService } from './media.service.js';

/** Runs transcodes, a few at a time (TRANSCODE_CONCURRENCY), on their own queue. */
@Injectable()
export class MediaProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MediaProcessor.name);
  private worker: Worker<TranscodeJob> | null = null;

  constructor(
    private readonly connections: Connections,
    private readonly media: MediaService,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
  ) {}

  onApplicationBootstrap() {
    this.worker = new Worker<TranscodeJob>(MEDIA_QUEUE, (job) => this.process(job), {
      connection: this.connections.redis.duplicate({ maxRetriesPerRequest: null }),
      prefix: QUEUE_PREFIX,
      concurrency: this.config.TRANSCODE_CONCURRENCY,
      // ffmpeg runs in a child process, so the lock keeps renewing; this only bounds a dead worker.
      lockDuration: 120_000,
    });
    this.worker.on('error', (error) => this.logger.error(`Worker: ${error.message}`));
  }

  async process(job: Job<TranscodeJob>) {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    try {
      return await this.media.transcode(job.data, { finalAttempt });
    } catch (error) {
      // A file that isn't a usable video won't become one on a retry.
      if (error instanceof UnusableVideoError) throw new UnrecoverableError(error.message);
      throw error;
    }
  }

  async onApplicationShutdown() {
    // Running transcodes finish first; queued ones wait in Redis for the next start.
    await this.worker?.close();
  }
}
