import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { WORKER_CONFIG, type WorkerConfig } from './config.js';

/** The layout shared with the API (apps/api/src/storage/storage.service.ts). */
export const mediaKeys = (schoolId: string, assetId: string) => {
  const root = `schools/${schoolId}/media/${assetId}`;
  return { root: `${root}/`, original: `${root}/original`, hls: (file: string) => `${root}/hls/${file}`, poster: `${root}/poster.jpg` };
};

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.vtt': 'text/vtt; charset=utf-8',
};

/** The worker's side of the video store: fetch originals, publish renditions, delete videos. */
@Injectable()
export class WorkerStorage {
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor(@Inject(WORKER_CONFIG) config: WorkerConfig) {
    this.bucket = config.S3_BUCKET ?? '';
    this.client =
      config.S3_BUCKET && config.S3_ENDPOINT && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? new S3Client({
            endpoint: config.S3_ENDPOINT,
            region: config.S3_REGION,
            forcePathStyle: config.S3_FORCE_PATH_STYLE,
            credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY },
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
          })
        : null;
  }

  private get s3(): S3Client {
    if (!this.client) throw new Error('Video storage is not configured (S3_BUCKET and friends).');
    return this.client;
  }

  async download(key: string, file: string): Promise<void> {
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    await pipeline(object.Body as Readable, createWriteStream(file));
  }

  /** Uploads every file under `dir` to `prefix` + its relative path. Returns the bytes stored. */
  async uploadDirectory(dir: string, keyFor: (relative: string) => string): Promise<number> {
    const files = await listFiles(dir);
    let total = 0;
    // A few at a time: enough to keep the connection busy without flooding a small server.
    for (let index = 0; index < files.length; index += 8) {
      const sizes = await Promise.all(
        files.slice(index, index + 8).map(async (relative) => {
          const full = path.join(dir, relative);
          const { size } = await stat(full);
          await this.s3.send(
            new PutObjectCommand({
              Bucket: this.bucket,
              Key: keyFor(relative.split(path.sep).join('/')),
              Body: createReadStream(full),
              ContentLength: size,
              ContentType: CONTENT_TYPES[path.extname(relative)] ?? 'application/octet-stream',
              // Rendition files never change under the same name.
              CacheControl: 'public, max-age=31536000, immutable',
            }),
          );
          return size;
        }),
      );
      total += sizes.reduce((sum, size) => sum + size, 0);
    }
    return total;
  }

  async uploadFile(file: string, key: string): Promise<number> {
    const { size } = await stat(file);
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(file),
        ContentLength: size,
        ContentType: CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return size;
  }

  /** Deletes everything under `prefix` (a whole video's folder). */
  async deletePrefix(prefix: string): Promise<void> {
    let token: string | undefined;
    do {
      const page = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (page.Contents ?? []).map((object) => ({ Key: object.Key! }));
      if (keys.length) await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  async deleteKey(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: [{ Key: key }], Quiet: true } }));
  }

  async abortUpload(key: string, uploadId: string): Promise<void> {
    await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId })).catch((error: { name?: string }) => {
      if (error.name !== 'NoSuchUpload') throw error;
    });
  }
}

async function listFiles(dir: string, base = ''): Promise<string[]> {
  const entries = await readdir(path.join(dir, base), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? listFiles(dir, path.join(base, entry.name)) : Promise.resolve([path.join(base, entry.name)]))),
  );
  return nested.flat().sort();
}
