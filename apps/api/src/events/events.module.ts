import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { OutboxService } from './outbox.service.js';

@Global()
@Module({ providers: [AuditService, OutboxService], exports: [AuditService, OutboxService] })
export class EventsModule {}
