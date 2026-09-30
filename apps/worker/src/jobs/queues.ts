/** BullMQ queue names. Keys in Redis are prefixed with "grand" so they're easy to tell apart. */
export const OUTBOX_QUEUE = 'outbox';
export const MAINTENANCE_QUEUE = 'maintenance';
export const QUEUE_PREFIX = 'grand';

export interface OutboxJob {
  outboxId: number;
}
