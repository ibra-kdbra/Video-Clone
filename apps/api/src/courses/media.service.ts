import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { CompleteUploadInput, LessonSummary, StartUploadInput, StorageUsage, UploadTicket } from '@grand/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { ApiException, notFound } from '../common/api-exception.js';
import type { SchoolContext } from '../common/request-context.js';
import { AppConfig } from '../config/app-config.js';
import { DatabaseService, type Tx } from '../database/database.service.js';
import { lessons, mediaAssets, schoolStorage } from '../database/schema.js';
import { AuditService } from '../events/audit.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { mediaKeys, StorageService } from '../storage/storage.service.js';
import { CoursesService, toLessonSummary } from './courses.service.js';
import { LessonsService } from './lessons.service.js';

const MIB = 1024 * 1024;
/** Signed part URLs last an hour; a slower upload asks for fresh ones. */
const PART_URL_TTL_SECONDS = 3600;

/** 16 MiB parts, larger only when a huge file would otherwise need more than S3's 10,000 parts. */
export const partSizeFor = (bytes: number) => Math.max(16 * MIB, Math.ceil(bytes / 10_000 / MIB) * MIB);
export const partCountFor = (bytes: number) => Math.ceil(bytes / partSizeFor(bytes));

const formatGb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(bytes < 10 * 1024 ** 3 ? 1 : 0)} GB`;

/**
 * Video uploads go from the browser straight to storage, in parts, through signed URLs: the API
 * never carries the bytes. Starting an upload reserves its size against the school's quota, so
 * parallel uploads can't overrun it; completing checks the stored size against the declared one
 * and hands the file to the worker for transcoding.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly courses: CoursesService,
    private readonly lessonsService: LessonsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig,
  ) {}

  async usage(school: SchoolContext, userId: string): Promise<StorageUsage> {
    const [row] = await this.db.transaction({ userId, schoolId: school.id }, (tx) => tx.select().from(schoolStorage).where(eq(schoolStorage.schoolId, school.id)));
    return {
      quotaBytes: row?.quotaBytes ?? 0,
      usedBytes: row?.usedBytes ?? 0,
      reservedBytes: row?.reservedBytes ?? 0,
      maxUploadBytes: this.config.media.maxUploadBytes,
    };
  }

  /** Starts an upload for the lesson's video (replacing any it had) and returns the part URLs. */
  async start(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, input: StartUploadInput, ip: string | null): Promise<UploadTicket> {
    if (!this.storage.enabled) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'service_unavailable', "Video uploads aren't set up on this server yet.");
    }
    if (input.size > this.config.media.maxUploadBytes) {
      throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, 'payload_too_large', `Videos can be up to ${formatGb(this.config.media.maxUploadBytes)}.`);
    }
    const assetId = randomUUID();
    const key = mediaKeys(school.id, assetId).original;
    const uploadId = await this.storage.createMultipartUpload(key, input.contentType);
    try {
      await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
        const course = await this.courses.findEditable(tx, school, userId, courseSlug);
        const { lesson } = await this.lessonsService.find(tx, school, userId, course, lessonId, { forUpdate: true });
        await this.reserve(tx, school.id, input.size);
        await tx.insert(mediaAssets).values({
          id: assetId,
          schoolId: school.id,
          uploadedBy: userId,
          fileName: input.fileName,
          contentType: input.contentType,
          declaredBytes: input.size,
          uploadId,
        });
        await tx
          .update(lessons)
          .set({ videoProvider: 'upload', mediaId: assetId, videoRef: null, durationSeconds: null })
          .where(eq(lessons.id, lesson.id));
        if (lesson.mediaId) await this.courses.scheduleMediaDeletion(tx, school.id, [lesson.mediaId]);
        await this.audit.record(tx, {
          action: 'media.upload_started',
          actorId: userId,
          schoolId: school.id,
          targetType: 'media',
          targetId: assetId,
          ip,
          data: { lessonId: lesson.id, bytes: input.size },
        });
      });
    } catch (error) {
      await this.storage.abortMultipartUpload(key, uploadId).catch(() => {});
      throw error;
    }
    const partNumbers = Array.from({ length: partCountFor(input.size) }, (_, index) => index + 1);
    return {
      assetId,
      partSize: partSizeFor(input.size),
      parts: await this.storage.presignParts(key, uploadId, partNumbers, PART_URL_TTL_SECONDS),
      expiresAt: new Date(Date.now() + PART_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Fresh URLs for parts that weren't sent before the first ones expired. */
  async moreParts(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, assetId: string, partNumbers: number[]) {
    const asset = await this.db.transaction({ userId, schoolId: school.id }, (tx) => this.findUpload(tx, school, userId, courseSlug, lessonId, assetId));
    const count = partCountFor(asset.declaredBytes);
    if (partNumbers.some((part) => part > count)) throw new ApiException(HttpStatus.BAD_REQUEST, 'bad_request', `This upload has ${count} parts.`);
    return {
      parts: await this.storage.presignParts(mediaKeys(school.id, assetId).original, asset.uploadId!, [...new Set(partNumbers)], PART_URL_TTL_SECONDS),
      expiresAt: new Date(Date.now() + PART_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Assembles the parts, checks the size, and queues the video for transcoding. */
  async complete(
    school: SchoolContext,
    userId: string,
    courseSlug: string,
    lessonId: string,
    assetId: string,
    input: CompleteUploadInput,
    ip: string | null,
  ): Promise<LessonSummary> {
    const asset = await this.db.transaction({ userId, schoolId: school.id }, (tx) => this.findUpload(tx, school, userId, courseSlug, lessonId, assetId));
    const key = mediaKeys(school.id, assetId).original;
    try {
      await this.storage.completeMultipartUpload(key, asset.uploadId!, input.parts);
    } catch (error) {
      this.logger.warn({ err: error, assetId }, 'Completing the upload failed');
      throw new ApiException(HttpStatus.BAD_REQUEST, 'bad_request', "Some parts of the video didn't arrive. Try the upload again.");
    }
    const size = await this.storage.size(key);

    const summary = await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const [current] = await tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.status, 'uploading'))).for('update');
      if (!current) throw new ApiException(HttpStatus.CONFLICT, 'conflict', 'This upload was already finished or cancelled.');
      await this.release(tx, school.id, current.declaredBytes);
      if (size !== current.declaredBytes) {
        await tx.update(mediaAssets).set({ status: 'failed', error: "The uploaded file wasn't the size it was declared to be.", uploadId: null }).where(eq(mediaAssets.id, assetId));
        await this.outbox.add(tx, 'media.deleted', { assetId, schoolId: school.id, keepRecord: true }, school.id);
        return null;
      }
      await tx.update(schoolStorage).set({ usedBytes: sql`${schoolStorage.usedBytes} + ${size}` }).where(eq(schoolStorage.schoolId, school.id));
      const [processing] = await tx
        .update(mediaAssets)
        .set({ status: 'processing', originalBytes: size, storedBytes: size, uploadId: null, progress: 0 })
        .where(eq(mediaAssets.id, assetId))
        .returning();
      await this.outbox.add(tx, 'media.uploaded', { assetId, schoolId: school.id, lessonId }, school.id);
      await this.audit.record(tx, { action: 'media.uploaded', actorId: userId, schoolId: school.id, targetType: 'media', targetId: assetId, ip, data: { bytes: size } });
      const [lesson] = await tx.select().from(lessons).where(eq(lessons.id, lessonId));
      return toLessonSummary(lesson!, processing!, false);
    });
    if (!summary) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'bad_request', "The video didn't upload completely. Try again.");
    }
    this.realtime.emitToSchool(school.id, 'media:updated', {
      schoolId: school.id,
      assetId,
      lessonId,
      status: 'processing',
      progress: 0,
      error: null,
      durationSeconds: null,
    });
    return summary;
  }

  /** Cancels an upload in progress: frees its reservation and takes it off the lesson. */
  async abort(school: SchoolContext, userId: string, courseSlug: string, lessonId: string, assetId: string): Promise<void> {
    const asset = await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const upload = await this.findUpload(tx, school, userId, courseSlug, lessonId, assetId);
      await this.release(tx, school.id, upload.declaredBytes);
      await tx
        .update(lessons)
        .set({ videoProvider: null, mediaId: null, videoRef: null, durationSeconds: null })
        .where(and(eq(lessons.id, lessonId), eq(lessons.mediaId, assetId)));
      await tx.delete(mediaAssets).where(eq(mediaAssets.id, assetId));
      return upload;
    });
    await this.storage.abortMultipartUpload(mediaKeys(school.id, assetId).original, asset.uploadId!);
  }

  private async findUpload(tx: Tx, school: SchoolContext, userId: string, courseSlug: string, lessonId: string, assetId: string) {
    const course = await this.courses.findEditable(tx, school, userId, courseSlug);
    const { lesson } = await this.lessonsService.find(tx, school, userId, course, lessonId);
    const [asset] = await tx.select().from(mediaAssets).where(eq(mediaAssets.id, assetId));
    if (!asset || lesson.mediaId !== assetId) throw notFound('This upload');
    if (asset.status !== 'uploading' || !asset.uploadId) {
      throw new ApiException(HttpStatus.CONFLICT, 'conflict', 'This upload was already finished or cancelled.');
    }
    return asset;
  }

  /** Holds `bytes` of the quota for an upload in progress; refuses when it doesn't fit. */
  private async reserve(tx: Tx, schoolId: string, bytes: number) {
    const [storage] = await tx.select().from(schoolStorage).where(eq(schoolStorage.schoolId, schoolId)).for('update');
    if (!storage) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'service_unavailable', 'Storage for this school is not set up.');
    const free = storage.quotaBytes - storage.usedBytes - storage.reservedBytes;
    if (bytes > free) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'quota_exceeded',
        `This school has ${formatGb(Math.max(0, free))} of video storage left, and this file needs ${formatGb(bytes)}.`,
      );
    }
    await tx.update(schoolStorage).set({ reservedBytes: sql`${schoolStorage.reservedBytes} + ${bytes}` }).where(eq(schoolStorage.schoolId, schoolId));
  }

  private async release(tx: Tx, schoolId: string, bytes: number) {
    await tx
      .update(schoolStorage)
      .set({ reservedBytes: sql`greatest(${schoolStorage.reservedBytes} - ${bytes}, 0)` })
      .where(eq(schoolStorage.schoolId, schoolId));
  }
}
