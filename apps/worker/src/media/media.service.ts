import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MediaStatus } from '@grand/contracts';
import { WORKER_CONFIG, type WorkerConfig } from '../config.js';
import { Connections } from '../connections.js';
import { RealtimeEmitter } from '../realtime.js';
import { mediaKeys, WorkerStorage } from '../storage.js';
import {
  hlsArgs,
  parseProbe,
  posterArgs,
  probeArgs,
  renditionsFor,
  run,
  storyboardArgs,
  storyboardVtt,
  UnusableVideoError,
} from './ffmpeg.js';
import type { TranscodeJob } from './media.queue.js';

/** Shown when ffmpeg fails for a reason the person can't see. */
const GENERIC_FAILURE = "This video couldn't be processed. Try exporting it as an MP4 (H.264) and uploading it again.";

interface AssetRow {
  id: string;
  status: MediaStatus;
  upload_id: string | null;
  declared_bytes: string;
  original_bytes: string | null;
  stored_bytes: string;
}

/**
 * Turns an uploaded original into an adaptive HLS ladder with a poster and a storyboard, keeps
 * the school's storage figures right, and tells the school's open pages how it's going. Also
 * deletes videos and clears away uploads that were never finished.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly connections: Connections,
    private readonly storage: WorkerStorage,
    private readonly realtime: RealtimeEmitter,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
  ) {}

  async transcode(job: TranscodeJob, { finalAttempt }: { finalAttempt: boolean }): Promise<'ready' | 'skipped' | 'discarded'> {
    const { assetId, schoolId } = job;
    const [asset] = await this.connections.withSchool(schoolId, (tx) => tx<AssetRow[]>`select * from media_assets where id = ${assetId}`);
    if (!asset || asset.status !== 'processing') return 'skipped';

    const keys = mediaKeys(schoolId, assetId);
    const dir = await mkdtemp(path.join(this.config.MEDIA_WORK_DIR ?? tmpdir(), 'grand-media-'));
    try {
      const input = path.join(dir, 'original');
      const hls = path.join(dir, 'hls');
      await mkdir(hls);
      await this.storage.download(keys.original, input);

      // ffprobe exits non-zero on anything it can't read as media.
      const probeJson = await run(this.config.FFPROBE_PATH, probeArgs(input), { timeoutMs: 60_000 }).catch(() => {
        throw new UnusableVideoError("This file couldn't be read as a video.");
      });
      const probe = parseProbe(probeJson, this.config.MEDIA_MAX_DURATION_SECONDS);
      const renditions = renditionsFor(probe);
      const report = this.progressReporter(job, probe.durationSeconds);
      await run(this.config.FFMPEG_PATH, hlsArgs(input, probe, renditions, this.config.TRANSCODE_THREADS), {
        cwd: hls,
        // Generous: a small server may encode at well under real time.
        timeoutMs: Math.max(15 * 60_000, probe.durationSeconds * 8_000),
        onProgress: (seconds) => report(Math.min(90, (seconds / probe.durationSeconds) * 90)),
      });
      await run(this.config.FFMPEG_PATH, posterArgs(input, probe, path.join(dir, 'poster.jpg')), { timeoutMs: 120_000 });
      await run(this.config.FFMPEG_PATH, storyboardArgs(input, probe, path.join(hls, 'storyboard-%d.jpg')), {
        timeoutMs: Math.max(10 * 60_000, probe.durationSeconds * 2_000),
      });
      await writeFile(path.join(hls, 'storyboard.vtt'), storyboardVtt(probe.durationSeconds));
      await report(95, true);

      const stored = (await this.storage.uploadDirectory(hls, (file) => keys.hls(file))) + (await this.storage.uploadFile(path.join(dir, 'poster.jpg'), keys.poster));
      const originalBytes = Number(asset.original_bytes ?? 0);
      const keepOriginal = this.config.MEDIA_KEEP_ORIGINALS;
      const total = stored + (keepOriginal ? originalBytes : 0);

      const finished = await this.connections.withSchool(schoolId, async (tx) => {
        const [current] = await tx<AssetRow[]>`select * from media_assets where id = ${assetId} for update`;
        // Deleted, or its lesson's video replaced, while it was transcoding.
        if (!current || current.status !== 'processing') return null;
        await tx`
          update media_assets set
            status = 'ready', progress = 100, error = null, ready_at = now(),
            duration_seconds = ${probe.durationSeconds}, width = ${probe.width}, height = ${probe.height},
            renditions = ${tx.json(renditions.map((rung) => ({ height: rung.height, name: rung.name, videoKbps: rung.videoKbps })))},
            has_storyboard = true, stored_bytes = ${total}
          where id = ${assetId}`;
        await tx`update school_storage set used_bytes = greatest(used_bytes + ${total - Number(current.stored_bytes)}, 0) where school_id = ${schoolId}`;
        const touched = await tx<{ id: string; course_id: string }[]>`
          update lessons set duration_seconds = ${Math.round(probe.durationSeconds)} where media_id = ${assetId} returning id, course_id`;
        // The first finished video becomes the course's cover until someone picks another.
        if (touched.length) {
          await tx`update courses set cover_media_id = ${assetId} where id = ${touched[0]!.course_id} and cover_media_id is null`;
        }
        return { lessonId: touched[0]?.id ?? job.lessonId };
      });

      if (!finished) {
        await this.storage.deletePrefix(keys.root);
        return 'discarded';
      }
      if (!keepOriginal) await this.storage.deleteKey(keys.original);
      this.realtime.media({
        schoolId,
        assetId,
        lessonId: finished.lessonId,
        status: 'ready',
        progress: 100,
        error: null,
        durationSeconds: Math.round(probe.durationSeconds),
      });
      this.logger.log(`Video ${assetId} ready: ${renditions.map((rung) => rung.name).join(', ')}, ${Math.round(probe.durationSeconds)} s`);
      return 'ready';
    } catch (error) {
      const unusable = error instanceof UnusableVideoError;
      this.logger.warn(`Transcoding ${assetId} failed${unusable || finalAttempt ? '' : ' (will retry)'}: ${(error as Error).message}`);
      if (unusable || finalAttempt) await this.fail(job, unusable ? (error as Error).message : GENERIC_FAILURE);
      throw error;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Marks the video failed, frees what it used and removes its files. */
  async fail(job: TranscodeJob, message: string) {
    const failed = await this.connections.withSchool(job.schoolId, async (tx) => {
      const [current] = await tx<AssetRow[]>`select * from media_assets where id = ${job.assetId} for update`;
      if (!current || current.status !== 'processing') return false;
      await tx`update media_assets set status = 'failed', error = ${message}, progress = 0, stored_bytes = 0 where id = ${job.assetId}`;
      await tx`update school_storage set used_bytes = greatest(used_bytes - ${Number(current.stored_bytes)}, 0) where school_id = ${job.schoolId}`;
      return true;
    });
    if (!failed) return;
    await this.storage.deletePrefix(mediaKeys(job.schoolId, job.assetId).root).catch(() => {});
    this.realtime.media({ schoolId: job.schoolId, assetId: job.assetId, lessonId: job.lessonId, status: 'failed', progress: 0, error: message, durationSeconds: null });
  }

  /**
   * Removes a video's files and frees its storage. An upload still in progress is cancelled and
   * its reservation released. The row goes too, unless asked to keep it as a failed record.
   */
  async remove({ assetId, schoolId, keepRecord = false }: { assetId: string; schoolId: string; keepRecord?: boolean }) {
    const keys = mediaKeys(schoolId, assetId);
    const pendingUpload = await this.connections.withSchool(schoolId, async (tx) => {
      const [current] = await tx<AssetRow[]>`select * from media_assets where id = ${assetId} for update`;
      if (!current || current.status !== 'uploading') return null;
      await tx`update school_storage set reserved_bytes = greatest(reserved_bytes - ${Number(current.declared_bytes)}, 0) where school_id = ${schoolId}`;
      await tx`update media_assets set status = 'failed', error = 'The upload was cancelled.', upload_id = null where id = ${assetId}`;
      return current.upload_id;
    });
    if (pendingUpload) await this.storage.abortUpload(keys.original, pendingUpload);
    await this.storage.deletePrefix(keys.root);

    await this.connections.withSchool(schoolId, async (tx) => {
      const [current] = await tx<AssetRow[]>`select * from media_assets where id = ${assetId} for update`;
      if (!current) return;
      await tx`update school_storage set used_bytes = greatest(used_bytes - ${Number(current.stored_bytes)}, 0) where school_id = ${schoolId}`;
      const [usage] = await tx<{ referenced: boolean }[]>`select exists (select 1 from lessons where media_id = ${assetId}) as referenced`;
      if (keepRecord || usage?.referenced) await tx`update media_assets set stored_bytes = 0 where id = ${assetId}`;
      else await tx`delete from media_assets where id = ${assetId}`;
    });
  }

  /** Uploads started more than a day ago and never finished: taken off their lessons and removed. */
  async abandonStaleUploads(): Promise<number> {
    const stale = await this.connections.sql<{ id: string; school_id: string }[]>`select id, school_id from app.stale_uploads(interval '24 hours')`;
    for (const { id, school_id: schoolId } of stale) {
      await this.connections.withSchool(schoolId, (tx) => tx`
        update lessons set video_provider = null, media_id = null, video_ref = null, duration_seconds = null where media_id = ${id}`);
      await this.remove({ assetId: id, schoolId });
    }
    return stale.length;
  }

  /** Saves and broadcasts progress at most every two seconds (or on a forced report). */
  private progressReporter(job: TranscodeJob, durationSeconds: number) {
    let last = 0;
    let lastPercent = -1;
    return async (percent: number, force = false) => {
      const rounded = Math.floor(percent);
      if (rounded === lastPercent || (!force && Date.now() - last < 2_000)) return;
      last = Date.now();
      lastPercent = rounded;
      await this.connections
        .withSchool(job.schoolId, (tx) => tx`update media_assets set progress = ${rounded} where id = ${job.assetId} and status = 'processing'`)
        .catch(() => {});
      this.realtime.media({
        schoolId: job.schoolId,
        assetId: job.assetId,
        lessonId: job.lessonId,
        status: 'processing',
        progress: rounded,
        error: null,
        durationSeconds: Math.round(durationSeconds),
      });
    };
  }
}
