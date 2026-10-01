import { eq, type SQL } from 'drizzle-orm';
import type { Tx } from '../database/database.service.js';
import { assignmentSubmissions, submissionFiles } from '../database/schema.js';
import type { OutboxService } from '../events/outbox.service.js';
import { submissionFileKey } from './storage.service.js';

/**
 * Before submissions are deleted (with their lesson, course, or the student's membership), queues
 * the removal of their files from storage and the return of that space to the school's quota.
 * The worker does it once the deletion has committed.
 */
export async function scheduleSubmissionFileDeletion(tx: Tx, outbox: OutboxService, schoolId: string, which: SQL | undefined) {
  const files = await tx
    .select({ id: submissionFiles.id, submissionId: submissionFiles.submissionId, sizeBytes: submissionFiles.sizeBytes, uploaded: submissionFiles.uploaded })
    .from(submissionFiles)
    .innerJoin(assignmentSubmissions, eq(assignmentSubmissions.id, submissionFiles.submissionId))
    .where(which);
  if (!files.length) return;
  await outbox.add(
    tx,
    'files.deleted',
    { schoolId, files: files.map((file) => ({ key: submissionFileKey(schoolId, file.submissionId, file.id), bytes: file.sizeBytes, uploaded: file.uploaded })) },
    schoolId,
  );
}
