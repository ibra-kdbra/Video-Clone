import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Playback } from '@grand/contracts';
import { and, eq } from 'drizzle-orm';
import { ApiException, notFound } from '../common/api-exception.js';
import type { SchoolContext } from '../common/request-context.js';
import { AppConfig } from '../config/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import { mediaAssets } from '../database/schema.js';
import { mediaKeys, StorageService } from '../storage/storage.service.js';
import { canWatchLesson } from './course-access.js';
import { CoursesService } from './courses.service.js';
import { enrollmentRequired, LessonsService } from './lessons.service.js';

export type PlaylistPath = { kind: 'master' } | { kind: 'variant'; rendition: string } | { kind: 'storyboard' };

const RENDITION = /^\d{3,4}p$/;
const TOKEN = /^(\d{10})\.([A-Za-z0-9_-]{43})$/;

/**
 * Playback of uploaded videos. The API hands out a playlist address carrying a token that is
 * signed for one video and expires; the playlists it serves list every segment as a signed
 * storage URL, so the bytes stream straight from storage and nothing in them works for long
 * once copied.
 */
@Injectable()
export class PlaybackService {
  private readonly key: Buffer;
  /** Rewritten variant playlists carry no token, only hour-signed URLs, so viewers share them. */
  private readonly variants = new Map<string, string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly courses: CoursesService,
    private readonly lessons: LessonsService,
    private readonly config: AppConfig,
  ) {
    // Its own key, derived from the JWT secret, so a playback token can never pass as anything else.
    this.key = createHmac('sha256', config.auth.jwtSecret).update('grand-lms:playback').digest();
  }

  async forLesson(school: SchoolContext, userId: string, courseSlug: string, lessonId: string): Promise<Playback> {
    const { lesson, media } = await this.db.transaction({ userId, schoolId: school.id }, async (tx) => {
      const course = await this.courses.findVisible(tx, school, userId, courseSlug);
      const row = await this.lessons.find(tx, school, userId, course, lessonId);
      const enrolled = await this.lessons.isEnrolled(tx, course.id, userId);
      if (!canWatchLesson(school, userId, course, row.lesson, enrolled)) throw enrollmentRequired();
      return row;
    });

    if (lesson.videoProvider && lesson.videoProvider !== 'upload' && lesson.videoRef) {
      return { kind: 'embed', provider: lesson.videoProvider, ref: lesson.videoRef };
    }
    if (lesson.videoProvider !== 'upload' || !media) throw notFound('A video for this lesson');
    if (media.status !== 'ready') return { kind: 'processing', status: media.status, progress: media.progress, error: media.error };

    const keys = mediaKeys(school.id, media.id);
    const poster = await this.storage.signedGet(keys.poster, this.config.media.urlTtlSeconds);
    const token = this.sign(school.id, media.id, Math.floor(poster.expiresAt.getTime() / 1000));
    const base = `/api/v1/media/${school.id}/${media.id}`;
    return {
      kind: 'hls',
      manifestUrl: `${base}/master.m3u8?t=${token}`,
      posterUrl: poster.url,
      storyboardUrl: media.hasStoryboard ? `${base}/storyboard.vtt?t=${token}` : null,
      durationSeconds: media.durationSeconds === null ? null : Math.round(media.durationSeconds),
      expiresAt: poster.expiresAt.toISOString(),
    };
  }

  /** A playlist or the storyboard, rewritten to signed addresses. Needs a valid token. */
  async playlist(schoolId: string, assetId: string, path: PlaylistPath, token: string): Promise<{ body: string; contentType: string }> {
    this.verify(schoolId, assetId, token);
    const [asset] = await this.db.transaction({ schoolId }, (tx) =>
      tx.select({ status: mediaAssets.status }).from(mediaAssets).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.status, 'ready'))),
    );
    if (!asset) throw notFound('This video');
    const keys = mediaKeys(schoolId, assetId);
    // Every viewer in the same hour shares these URLs (see `variants`), so they're signed for the
    // full lifetime: they outlast any token issued up to now, whoever asked first.
    const ttl = this.config.media.urlTtlSeconds;

    if (path.kind === 'master') {
      const text = await this.storage.text(keys.hls('master.m3u8'));
      if (text === null) throw notFound('This video');
      // Variant playlists are relative to this one; they keep the token in their query string.
      return { body: mapUris(text, (uri) => `${uri}?t=${token}`), contentType: 'application/vnd.apple.mpegurl' };
    }

    if (path.kind === 'variant') {
      if (!RENDITION.test(path.rendition)) throw notFound('This video');
      const key = keys.hls(`${path.rendition}/index.m3u8`);
      const window = Math.floor(Date.now() / 3_600_000);
      const cached = this.variants.get(`${key}|${window}`);
      if (cached) return { body: cached, contentType: 'application/vnd.apple.mpegurl' };
      const text = await this.storage.text(key);
      if (text === null) throw notFound('This video');
      const body = await mapUrisAsync(text, async (uri) => (await this.storage.signedGet(keys.hls(`${path.rendition}/${uri}`), ttl)).url);
      if (this.variants.size >= 500) this.variants.delete(this.variants.keys().next().value!);
      this.variants.set(`${key}|${window}`, body);
      return { body, contentType: 'application/vnd.apple.mpegurl' };
    }

    const text = await this.storage.text(keys.hls('storyboard.vtt'));
    if (text === null) throw notFound('This video');
    const body = await mapVtt(text, async (image) => (await this.storage.signedGet(keys.hls(image), ttl)).url);
    return { body, contentType: 'text/vtt; charset=utf-8' };
  }

  sign(schoolId: string, assetId: string, expiresAt: number): string {
    return `${expiresAt}.${this.mac(schoolId, assetId, expiresAt)}`;
  }

  /** Returns the token's expiry (seconds), or refuses an invalid or expired token. */
  verify(schoolId: string, assetId: string, token: string): number {
    const match = TOKEN.exec(token);
    const expired = () => new ApiException(HttpStatus.FORBIDDEN, 'forbidden', 'This video link has expired. Reload the lesson.');
    if (!match) throw expired();
    const expiresAt = Number(match[1]);
    const expected = Buffer.from(this.mac(schoolId, assetId, expiresAt));
    const given = Buffer.from(match[2]!);
    if (given.length !== expected.length || !timingSafeEqual(given, expected) || expiresAt * 1000 < Date.now()) throw expired();
    return expiresAt;
  }

  private mac(schoolId: string, assetId: string, expiresAt: number) {
    return createHmac('sha256', this.key).update(`${schoolId}/${assetId}/${expiresAt}`).digest('base64url');
  }
}

/** Applies `map` to every URI in an HLS playlist: plain lines and URI="…" attributes. */
export function mapUris(playlist: string, map: (uri: string) => string): string {
  return playlist
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${map(uri)}"`);
      return map(trimmed);
    })
    .join('\n');
}

async function mapUrisAsync(playlist: string, map: (uri: string) => Promise<string>): Promise<string> {
  const uris = new Set<string>();
  mapUris(playlist, (uri) => (uris.add(uri), uri));
  const mapped = new Map(await Promise.all([...uris].map(async (uri) => [uri, await map(safeName(uri))] as const)));
  return mapUris(playlist, (uri) => mapped.get(uri)!);
}

/** WebVTT storyboard: "sprite-0.jpg#xywh=0,0,160,90" lines get signed image addresses. */
async function mapVtt(vtt: string, sign: (image: string) => Promise<string>): Promise<string> {
  const images = new Set<string>();
  for (const line of vtt.split('\n')) {
    const match = /^([\w.-]+\.jpg)#xywh=/.exec(line.trim());
    if (match) images.add(match[1]!);
  }
  const signed = new Map(await Promise.all([...images].map(async (image) => [image, await sign(safeName(image))] as const)));
  return vtt
    .split('\n')
    .map((line) => line.replace(/^([\w.-]+\.jpg)(?=#xywh=)/, (image) => signed.get(image) ?? image))
    .join('\n');
}

/** Playlists are written by the worker, but a path in one must still never leave the video's folder. */
function safeName(name: string): string {
  if (!/^[\w.-]+$/.test(name) || name.includes('..')) throw new Error(`Unexpected file name in a playlist: ${name}`);
  return name;
}
