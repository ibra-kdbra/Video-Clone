import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiException } from '../common/api-exception.js';
import { AppConfig } from '../config/app-config.js';

/** Where an asset's files live in the bucket. The worker writes the same layout. */
export const mediaKeys = (schoolId: string, assetId: string) => {
  const root = `schools/${schoolId}/media/${assetId}`;
  return {
    root: `${root}/`,
    original: `${root}/original`,
    hls: (path: string) => `${root}/hls/${path}`,
    poster: `${root}/poster.jpg`,
  };
};

/** Where a file handed in with an assignment lives. */
export const submissionFileKey = (schoolId: string, submissionId: string, fileId: string) => `schools/${schoolId}/submissions/${submissionId}/${fileId}`;

/** Signed URLs are made for fixed one-hour windows, so a URL repeats within the hour and caches. */
const SIGNING_WINDOW_MS = 3_600_000;

/**
 * Talks to the S3-compatible video store. Two clients: the internal one for the API's own calls
 * (inside the server's network), and the public one only for signing the URLs browsers use, since
 * a signature covers the host name it was made for.
 */
@Injectable()
export class StorageService {
  private readonly internal: S3Client | null = null;
  private readonly public: S3Client | null = null;
  private readonly bucket: string = '';
  private readonly cache = new Map<string, string>();

  constructor(config: AppConfig) {
    const storage = config.storage;
    if (!storage) return;
    const base = {
      region: storage.region,
      forcePathStyle: storage.forcePathStyle,
      credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
      // Not every S3-compatible store accepts the SDK's newer default checksums, and browsers
      // uploading to a signed URL can't add them either.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.internal = new S3Client({ ...base, endpoint: storage.endpoint });
    this.public = new S3Client({ ...base, endpoint: storage.publicEndpoint });
    this.bucket = storage.bucket;
  }

  get enabled() {
    return this.internal !== null;
  }

  private clients(): { internal: S3Client; public: S3Client } {
    if (!this.internal || !this.public) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'service_unavailable', "Video uploads aren't set up on this server yet.");
    }
    return { internal: this.internal, public: this.public };
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const { UploadId } = await this.clients().internal.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
    );
    if (!UploadId) throw new Error('The store returned no upload id');
    return UploadId;
  }

  /** Signed PUT URLs for the parts of a multipart upload, for the browser to send straight to storage. */
  presignParts(key: string, uploadId: string, partNumbers: number[], expiresIn: number) {
    const client = this.clients().public;
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(client, new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }), {
          expiresIn,
        }),
      })),
    );
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
    await this.clients().internal.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string) {
    await this.clients()
      .internal.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }))
      .catch((error: { name?: string }) => {
        if (error.name !== 'NoSuchUpload') throw error;
      });
  }

  /** A signed URL for uploading one object with a single PUT, sent with exactly this Content-Type. */
  async presignPut(key: string, contentType: string, expiresIn: number): Promise<{ url: string; expiresAt: Date }> {
    const url = await getSignedUrl(this.clients().public, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), {
      expiresIn,
      signableHeaders: new Set(['content-type']),
    });
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  /**
   * A signed URL that downloads the object as a file with this name, never displayed in the
   * browser, whatever it contains.
   */
  async signedDownload(key: string, fileName: string, expiresIn: number): Promise<{ url: string; expiresAt: Date }> {
    const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
    const url = await getSignedUrl(
      this.clients().public,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        ResponseContentType: 'application/octet-stream',
      }),
      { expiresIn },
    );
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  async deleteObject(key: string) {
    await this.clients().internal.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** The object's size, or null when it doesn't exist. */
  async size(key: string): Promise<number | null> {
    try {
      const head = await this.clients().internal.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? null;
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFound') return null;
      throw error;
    }
  }

  /** A small text object (a playlist or a WebVTT file). Ready media never changes, so it's cached. */
  async text(key: string): Promise<string | null> {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const object = await this.clients().internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = (await object.Body?.transformToString('utf-8')) ?? '';
      if (this.cache.size >= 1_000) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, body);
      return body;
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') return null;
      throw error;
    }
  }

  /**
   * A signed GET URL that works for at least `minTtlSeconds`. URLs are signed for the start of
   * the current hour, so the same object gets the same URL all hour and browsers can cache it.
   */
  async signedGet(key: string, minTtlSeconds: number, now = Date.now()): Promise<{ url: string; expiresAt: Date }> {
    const windowStart = Math.floor(now / SIGNING_WINDOW_MS) * SIGNING_WINDOW_MS;
    const expiresIn = minTtlSeconds + SIGNING_WINDOW_MS / 1000;
    const url = await getSignedUrl(this.clients().public, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn,
      signingDate: new Date(windowStart),
    });
    return { url, expiresAt: new Date(windowStart + expiresIn * 1000) };
  }
}
