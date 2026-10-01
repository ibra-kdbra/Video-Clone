import { Injectable } from '@nestjs/common';
import type { Tx } from '../database/database.service.js';
import { outbox } from '../database/schema.js';

/**
 * Queues an event for the worker in the same transaction as the change it describes, so the event
 * exists exactly when the change does. The worker hears about it through LISTEN/NOTIFY.
 */
@Injectable()
export class OutboxService {
  async add(tx: Tx, type: string, payload: Record<string, unknown>, schoolId: string | null = null) {
    await tx.insert(outbox).values({ type, payload, schoolId });
  }
}
