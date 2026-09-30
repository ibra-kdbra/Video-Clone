import { Injectable } from '@nestjs/common';
import type { Tx } from '../database/database.service.js';
import { auditLog } from '../database/schema.js';

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  schoolId?: string | null;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  data?: Record<string, unknown>;
}

/** Records who did what, in the same transaction as the change. The table is append-only. */
@Injectable()
export class AuditService {
  async record(tx: Tx, entry: AuditEntry) {
    await tx.insert(auditLog).values({
      action: entry.action,
      actorId: entry.actorId ?? null,
      schoolId: entry.schoolId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ip: entry.ip ?? null,
      data: entry.data ?? {},
    });
  }
}
