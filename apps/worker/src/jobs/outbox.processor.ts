import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import { WORKER_CONFIG, type WorkerConfig } from '../config.js';
import { Connections } from '../connections.js';
import { MailerService } from '../mail/mailer.service.js';
import { MediaQueue } from '../media/media.queue.js';
import { MediaService } from '../media/media.service.js';
import { type InvitationEmail, invitationEmail } from '../mail/templates.js';
import { type DeletedFile, SubmissionFilesService } from '../files/submission-files.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OUTBOX_QUEUE, type OutboxJob, QUEUE_PREFIX } from './queues.js';

interface Handler {
  run(payload: Record<string, unknown>, event: { id: number; schoolId: string | null }): Promise<unknown>;
  /** Payload fields removed once handled, such as a secret link that has been emailed. */
  scrub?: string[];
}

/**
 * Handles outbox events. Each is handled at most once as far as the database is concerned
 * (processed_at is checked first and set last); a crash between the two can repeat an email,
 * never lose one.
 */
@Injectable()
export class OutboxProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxProcessor.name);
  private worker: Worker<OutboxJob> | null = null;
  private readonly handlers: Record<string, Handler>;

  constructor(
    private readonly connections: Connections,
    mailer: MailerService,
    mediaQueue: MediaQueue,
    media: MediaService,
    notifications: NotificationsService,
    files: SubmissionFilesService,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
  ) {
    this.handlers = {
      'invitation.created': {
        run: (payload) => mailer.send(invitationEmail(payload as unknown as InvitationEmail)),
        scrub: ['url'],
      },
      'media.uploaded': {
        run: (payload) => mediaQueue.enqueue({ assetId: String(payload.assetId), schoolId: String(payload.schoolId), lessonId: (payload.lessonId as string) ?? null }),
      },
      'media.deleted': {
        run: (payload) => media.remove({ assetId: String(payload.assetId), schoolId: String(payload.schoolId), keepRecord: payload.keepRecord === true }),
      },
      'files.deleted': {
        run: (payload) => files.deleted({ schoolId: String(payload.schoolId), files: payload.files as DeletedFile[] }),
      },
      'course.published': {
        run: (payload, event) => notifications.coursePublished(payload as { courseId: string; schoolId: string; actorId?: string }, event.id),
      },
      'lesson.published': {
        run: (payload, event) => notifications.lessonPublished(payload as { lessonId: string; courseId: string; actorId?: string }, event.schoolId!, event.id),
      },
      'assignment.submitted': {
        run: (payload, event) => notifications.assignmentSubmitted(payload as Parameters<NotificationsService['assignmentSubmitted']>[0], event.schoolId!, event.id),
      },
      'assignment.graded': {
        run: (payload, event) => notifications.assignmentGraded(payload as Parameters<NotificationsService['assignmentGraded']>[0], event.schoolId!, event.id),
      },
      'discussion.posted': {
        run: (payload, event) => notifications.discussionPosted(payload as Parameters<NotificationsService['discussionPosted']>[0], event.schoolId!, event.id),
      },
      'discussion.replied': {
        run: (payload, event) => notifications.discussionReplied(payload as Parameters<NotificationsService['discussionReplied']>[0], event.schoolId!, event.id),
      },
      'discussion.reported': {
        run: (payload, event) => notifications.discussionReported(payload as Parameters<NotificationsService['discussionReported']>[0], event.schoolId!, event.id),
      },
      'live.scheduled': {
        run: (payload, event) => notifications.liveScheduled(payload as Parameters<NotificationsService['liveScheduled']>[0], event.schoolId!, event.id),
      },
      'live.started': {
        run: (payload, event) => notifications.liveStarted(payload as Parameters<NotificationsService['liveStarted']>[0], event.schoolId!, event.id),
      },
      // Recorded for later features (analytics); nothing to do yet.
      'school.created': { run: async () => {} },
      'member.joined': { run: async () => {} },
    };
  }

  onApplicationBootstrap() {
    this.worker = new Worker<OutboxJob>(OUTBOX_QUEUE, (job) => this.process(job), {
      connection: this.connections.redis.duplicate({ maxRetriesPerRequest: null }),
      prefix: QUEUE_PREFIX,
      concurrency: 5,
      limiter: { max: this.config.MAIL_RATE_PER_SECOND, duration: 1_000 },
    });
    this.worker.on('failed', (job, error) => {
      this.logger.warn(`Event ${job?.data.outboxId} (${job?.name}) failed, attempt ${job?.attemptsMade}: ${error.message}`);
      if (job) void this.connections.sql`update outbox set last_error = ${error.message.slice(0, 1000)} where id = ${job.data.outboxId}`.catch(() => {});
    });
    this.worker.on('error', (error) => this.logger.error(`Worker: ${error.message}`));
  }

  async process(job: Job<OutboxJob>): Promise<'done' | 'skipped'> {
    const { sql } = this.connections;
    const [event] = await sql<{ type: string; school_id: string | null; payload: Record<string, unknown>; processed_at: Date | null }[]>`
      update outbox set attempts = attempts + 1
      where id = ${job.data.outboxId}
      returning type, school_id, payload, processed_at`;
    if (!event || event.processed_at) return 'skipped';

    const handler = this.handlers[event.type];
    if (!handler) this.logger.warn(`No handler for ${event.type}; marking it done`);
    else await handler.run(event.payload, { id: job.data.outboxId, schoolId: event.school_id });

    const scrub = handler?.scrub ?? [];
    await sql`
      update outbox
      set processed_at = now(), last_error = null, payload = payload - ${sql.array(scrub)}::text[]
      where id = ${job.data.outboxId}`;
    return 'done';
  }

  async onApplicationShutdown() {
    // Lets running jobs finish; queued ones stay in Redis for the next start.
    await this.worker?.close();
  }
}
