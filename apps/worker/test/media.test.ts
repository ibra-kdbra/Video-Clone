import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CreateMultipartUploadCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { MediaUpdate } from '@grand/contracts';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { UnusableVideoError } from '../src/media/ffmpeg.js';
import { MediaService } from '../src/media/media.service.js';
import { RealtimeEmitter } from '../src/realtime.js';
import { WorkerModule } from '../src/worker.module.js';

const s3config = inject('s3');
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!s3config || !hasFfmpeg)('video pipeline', () => {
  const updates: MediaUpdate[] = [];
  const work = mkdtempSync(path.join(tmpdir(), 'grand-worker-test-'));
  let owner: postgres.Sql;
  let s3: S3Client;
  let media: MediaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    owner = postgres(inject('ownerDatabaseUrl'), { max: 1, onnotice: () => {} });
    s3 = new S3Client({
      endpoint: s3config!.endpoint,
      region: s3config!.region,
      forcePathStyle: true,
      credentials: { accessKeyId: s3config!.accessKeyId, secretAccessKey: s3config!.secretAccessKey },
    });
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: inject('appDatabaseUrl'),
      REDIS_URL: inject('redisUrl'),
      S3_ENDPOINT: s3config!.endpoint,
      S3_REGION: s3config!.region,
      S3_BUCKET: s3config!.bucket,
      S3_ACCESS_KEY_ID: s3config!.accessKeyId,
      S3_SECRET_ACCESS_KEY: s3config!.secretAccessKey,
      MEDIA_MAX_DURATION_SECONDS: '60',
    });
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(config)] })
      .overrideProvider(RealtimeEmitter)
      .useValue({ media: (update: MediaUpdate) => void updates.push(update), toUser: () => {} })
      .compile();
    media = moduleRef.get(MediaService);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    await close();
    await owner.end();
    s3.destroy();
    rmSync(work, { recursive: true, force: true });
  });

  beforeEach(() => {
    updates.length = 0;
  });

  /** A test clip made by ffmpeg. */
  function clip(name: string, size: string, seconds: number, audio = true): Buffer {
    const file = path.join(work, name);
    const args = ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=25`];
    if (audio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000');
    args.push('-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
    if (audio) args.push('-c:a', 'aac', '-shortest');
    execFileSync('ffmpeg', [...args, file]);
    return readFileSync(file);
  }

  /** A school with a course, a lesson and an uploaded original waiting to be transcoded. */
  async function uploaded(file: Buffer, status: 'processing' | 'uploading' = 'processing') {
    const [school] = await owner<{ id: string }[]>`insert into schools (slug, name) values (${`media-${Math.random().toString(36).slice(2, 10)}`}, 'Media School') returning id`;
    const schoolId = school!.id;
    const [course] = await owner<{ id: string }[]>`insert into courses (school_id, slug, title) values (${schoolId}, 'course', 'Course') returning id`;
    const [module] = await owner<{ id: string }[]>`insert into course_modules (school_id, course_id, title, position) values (${schoolId}, ${course!.id}, 'M', 0) returning id`;
    const [asset] = await owner<{ id: string }[]>`
      insert into media_assets (school_id, status, file_name, content_type, declared_bytes, original_bytes, stored_bytes)
      values (${schoolId}, ${status}, 'clip.mp4', 'video/mp4', ${file.length}, ${file.length}, ${status === 'processing' ? file.length : 0}) returning id`;
    const [lesson] = await owner<{ id: string }[]>`
      insert into lessons (school_id, course_id, module_id, title, position, video_provider, media_id)
      values (${schoolId}, ${course!.id}, ${module!.id}, 'L', 0, 'upload', ${asset!.id}) returning id`;
    if (status === 'processing') {
      await owner`update school_storage set used_bytes = ${file.length} where school_id = ${schoolId}`;
      await s3.send(new PutObjectCommand({ Bucket: s3config!.bucket, Key: `schools/${schoolId}/media/${asset!.id}/original`, Body: file }));
    }
    return { schoolId, courseId: course!.id, lessonId: lesson!.id, assetId: asset!.id };
  }

  const objects = async (schoolId: string, assetId: string) =>
    ((await s3.send(new ListObjectsV2Command({ Bucket: s3config!.bucket, Prefix: `schools/${schoolId}/media/${assetId}/` }))).Contents ?? [])
      .map((object) => object.Key!.split(`${assetId}/`)[1]!)
      .sort();
  const used = async (schoolId: string) => (await owner<{ used: number }[]>`select used_bytes::int as used from school_storage where school_id = ${schoolId}`)[0]!.used;

  it('turns an upload into an HLS ladder with a poster and storyboard, and keeps the books right', async () => {
    const file = clip('landscape.mp4', '960x540', 4);
    const job = await uploaded(file);
    expect(await media.transcode(job, { finalAttempt: true })).toBe('ready');

    const files = await objects(job.schoolId, job.assetId);
    expect(files).toEqual(
      expect.arrayContaining(['hls/master.m3u8', 'hls/480p/index.m3u8', 'hls/360p/index.m3u8', 'hls/storyboard.vtt', 'hls/storyboard-0.jpg', 'poster.jpg']),
    );
    expect(files.some((name) => /^hls\/480p\/init_\d+\.mp4$/.test(name))).toBe(true);
    expect(files.filter((name) => /^hls\/480p\/seg_\d{4}\.m4s$/.test(name)).length).toBeGreaterThan(0);
    expect(files).not.toContain('original');

    const [asset] = await owner`select * from media_assets where id = ${job.assetId}`;
    expect(asset).toMatchObject({ status: 'ready', progress: 100, width: 960, height: 540, has_storyboard: true, error: null });
    expect(Number(asset!.duration_seconds)).toBeCloseTo(4, 0);
    expect(asset!.renditions.map((rung: { name: string }) => rung.name)).toEqual(['480p', '360p']);
    expect(await used(job.schoolId)).toBe(Number(asset!.stored_bytes));

    const [lesson] = await owner`select duration_seconds from lessons where id = ${job.lessonId}`;
    expect(lesson!.duration_seconds).toBe(4);
    const [course] = await owner`select cover_media_id from courses where id = ${job.courseId}`;
    expect(course!.cover_media_id).toBe(job.assetId);
    expect(updates.at(-1)).toMatchObject({ assetId: job.assetId, status: 'ready', progress: 100, durationSeconds: 4 });
    expect(updates.some((update) => update.status === 'processing')).toBe(true);
  });

  it('handles portrait video and video without sound', async () => {
    const job = await uploaded(clip('portrait.mp4', '360x640', 2, false));
    expect(await media.transcode(job, { finalAttempt: true })).toBe('ready');
    const [asset] = await owner`select width, height, renditions from media_assets where id = ${job.assetId}`;
    expect(asset).toMatchObject({ width: 360, height: 640 });
    expect(asset!.renditions.map((rung: { name: string }) => rung.name)).toEqual(['360p']);
  });

  it('fails a file that is not a video, telling why, and frees its storage', async () => {
    const job = await uploaded(Buffer.from('definitely not a video'.repeat(100)));
    await expect(media.transcode(job, { finalAttempt: false })).rejects.toBeInstanceOf(UnusableVideoError);
    const [asset] = await owner`select status, error, stored_bytes from media_assets where id = ${job.assetId}`;
    expect(asset!.status).toBe('failed');
    expect(asset!.error).toMatch(/video/);
    expect(await used(job.schoolId)).toBe(0);
    expect(await objects(job.schoolId, job.assetId)).toEqual([]);
    expect(updates.at(-1)).toMatchObject({ status: 'failed', error: asset!.error });
  });

  it('refuses videos longer than allowed', async () => {
    const job = await uploaded(clip('long.mp4', '320x240', 61, false));
    await expect(media.transcode(job, { finalAttempt: false })).rejects.toThrow(/up to 1 minutes/);
  });

  it('skips a video that was deleted while it waited', async () => {
    const job = await uploaded(clip('gone.mp4', '320x240', 1, false));
    await owner`update media_assets set status = 'failed' where id = ${job.assetId}`;
    expect(await media.transcode(job, { finalAttempt: true })).toBe('skipped');
  });

  it('deletes a video: its files, its row, and its share of the quota', async () => {
    const job = await uploaded(clip('delete.mp4', '320x240', 1, false));
    await media.transcode(job, { finalAttempt: true });
    await owner`update lessons set video_provider = null, media_id = null where id = ${job.lessonId}`;
    await media.remove({ assetId: job.assetId, schoolId: job.schoolId });
    expect(await objects(job.schoolId, job.assetId)).toEqual([]);
    expect(await owner`select 1 from media_assets where id = ${job.assetId}`).toHaveLength(0);
    expect(await used(job.schoolId)).toBe(0);
  });

  it('clears away uploads abandoned for a day: cancels them, frees the reservation, detaches the lesson', async () => {
    const job = await uploaded(Buffer.alloc(10), 'uploading');
    const key = `schools/${job.schoolId}/media/${job.assetId}/original`;
    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket: s3config!.bucket, Key: key }));
    await owner`update media_assets set upload_id = ${UploadId!}, created_at = now() - interval '2 days' where id = ${job.assetId}`;
    await owner`update school_storage set reserved_bytes = 10 where school_id = ${job.schoolId}`;

    expect(await media.abandonStaleUploads()).toBeGreaterThanOrEqual(1);
    expect(await owner`select 1 from media_assets where id = ${job.assetId}`).toHaveLength(0);
    const [lesson] = await owner`select video_provider, media_id from lessons where id = ${job.lessonId}`;
    expect(lesson).toEqual({ video_provider: null, media_id: null });
    const [storage] = await owner`select reserved_bytes::int as reserved from school_storage where school_id = ${job.schoolId}`;
    expect(storage!.reserved).toBe(0);
  });
});
