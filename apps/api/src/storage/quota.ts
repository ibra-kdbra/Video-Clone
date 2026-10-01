import { HttpStatus } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import type { Tx } from '../database/database.service.js';
import { schoolStorage } from '../database/schema.js';

/**
 * A school's storage quota, shared by its videos and the files students hand in. An upload in
 * progress holds its declared size as `reserved` (with the row locked, so two uploads can't both
 * take the last free space); a finished one counts as `used`.
 */

export const formatSize = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(bytes < 10 * 1024 ** 3 ? 1 : 0)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;

/** Holds `bytes` of the quota for an upload in progress; refuses when it doesn't fit. */
export async function reserveQuota(tx: Tx, schoolId: string, bytes: number) {
  const [storage] = await tx.select().from(schoolStorage).where(eq(schoolStorage.schoolId, schoolId)).for('update');
  if (!storage) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'service_unavailable', 'Storage for this school is not set up.');
  const free = storage.quotaBytes - storage.usedBytes - storage.reservedBytes;
  if (bytes > free) {
    throw new ApiException(HttpStatus.FORBIDDEN, 'quota_exceeded', `This school has ${formatSize(Math.max(0, free))} of storage left, and this file needs ${formatSize(bytes)}.`);
  }
  await tx.update(schoolStorage).set({ reservedBytes: sql`${schoolStorage.reservedBytes} + ${bytes}` }).where(eq(schoolStorage.schoolId, schoolId));
}

/** Gives back a reservation (the upload finished or was abandoned). */
export async function releaseQuota(tx: Tx, schoolId: string, bytes: number) {
  await tx.update(schoolStorage).set({ reservedBytes: sql`greatest(${schoolStorage.reservedBytes} - ${bytes}, 0)` }).where(eq(schoolStorage.schoolId, schoolId));
}

/** Counts stored bytes as used, or (negative) frees them. */
export async function addUsedQuota(tx: Tx, schoolId: string, bytes: number) {
  await tx.update(schoolStorage).set({ usedBytes: sql`greatest(${schoolStorage.usedBytes} + ${bytes}, 0)` }).where(eq(schoolStorage.schoolId, schoolId));
}
