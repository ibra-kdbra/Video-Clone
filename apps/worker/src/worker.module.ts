import { type DynamicModule, Module } from '@nestjs/common';
import { WORKER_CONFIG, type WorkerConfig } from './config.js';
import { Connections } from './connections.js';
import { MaintenanceService } from './jobs/maintenance.service.js';
import { OutboxProcessor } from './jobs/outbox.processor.js';
import { OutboxRelayService } from './jobs/outbox-relay.service.js';
import { MailerService } from './mail/mailer.service.js';
import { MediaProcessor } from './media/media.processor.js';
import { MediaQueue } from './media/media.queue.js';
import { MediaService } from './media/media.service.js';
import { RealtimeEmitter } from './realtime.js';
import { WorkerStorage } from './storage.js';

@Module({})
export class WorkerModule {
  static forRoot(config: WorkerConfig): DynamicModule {
    return {
      module: WorkerModule,
      providers: [
        { provide: WORKER_CONFIG, useValue: config },
        Connections,
        WorkerStorage,
        RealtimeEmitter,
        MailerService,
        MediaQueue,
        MediaService,
        MediaProcessor,
        OutboxRelayService,
        OutboxProcessor,
        MaintenanceService,
      ],
      exports: [OutboxRelayService, OutboxProcessor, MaintenanceService, MediaService, MediaQueue, MediaProcessor, Connections],
    };
  }
}
