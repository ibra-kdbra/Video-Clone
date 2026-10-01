import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Connections } from '../connections.js';
import { QUEUE_PREFIX } from '../jobs/queues.js';

export const MEDIA_QUEUE = 'media';

export interface TranscodeJob {
  assetId: string;
  schoolId: string;
  lessonId: string | null;
}

/** Transcoding jobs, kept apart from the outbox queue so a long video never holds up email. */
@Injectable()
export class MediaQueue implements OnApplicationShutdown {
  readonly queue: Queue<TranscodeJob>;

  constructor(connections: Connections) {
    this.queue = new Queue<TranscodeJob>(MEDIA_QUEUE, {
      connection: connections.redis,
      prefix: QUEUE_PREFIX,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 60_000 },
        removeOnComplete: { age: 7 * 86_400 },
        removeOnFail: { age: 30 * 86_400 },
      },
    });
  }

  /** Queues a transcode once per video, however many times the event is relayed. */
  async enqueue(job: TranscodeJob) {
    await this.queue.add('transcode', job, { jobId: `transcode-${job.assetId}` });
  }

  async onApplicationShutdown() {
    await this.queue.close();
  }
}
