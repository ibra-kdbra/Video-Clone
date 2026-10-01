import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { TestApi, uniqueSlug, WEB_ORIGIN } from './helpers.js';

const s3config = inject('s3');

describe.skipIf(!s3config)('video uploads and playback', () => {
  let api: TestApi;
  let owner: postgres.Sql;
  let s3: S3Client;

  beforeAll(async () => {
    api = await TestApi.start();
    owner = postgres(inject('ownerDatabaseUrl'), { max: 1, onnotice: () => {} });
    s3 = new S3Client({
      endpoint: s3config!.endpoint,
      region: s3config!.region,
      forcePathStyle: true,
      credentials: { accessKeyId: s3config!.accessKeyId, secretAccessKey: s3config!.secretAccessKey },
    });
  });
  afterAll(async () => {
    await api.close();
    await owner.end();
    s3.destroy();
  });

  /** An instructor's published course with one published lesson, and an enrolled and a new student. */
  async function setup() {
    const author = await api.signup('Author');
    const enrolled = await api.signup('Enrolled');
    const visitor = await api.signup('Visitor');
    const created = await api.createSchool(author.token, uniqueSlug(), 'Video School');
    for (const person of [enrolled, visitor]) {
      await owner`insert into memberships (school_id, user_id, role) values (${created.id}, ${person.user.id}, 'student')`;
    }
    const base = `/schools/${created.slug}/courses`;
    const { body: course } = await api.request('POST', base, { token: author.token, body: { title: 'Video course' } });
    const url = `${base}/${course.slug}`;
    const { body: lesson } = await api.request('POST', `${url}/lessons`, { token: author.token, body: { moduleId: course.modules[0].id, title: 'Clip' } });
    await api.request('PATCH', `${url}/lessons/${lesson.id}`, { token: author.token, body: { status: 'published' } });
    await api.request('PATCH', url, { token: author.token, body: { status: 'published' } });
    await api.request('POST', `${url}/enrollment`, { token: enrolled.token });
    return { author, enrolled, visitor, school: created, url, lesson, lessonUrl: `${url}/lessons/${lesson.id}` };
  }

  const storage = async (schoolId: string) =>
    (await owner<{ used: number; reserved: number }[]>`select used_bytes::int as used, reserved_bytes::int as reserved from school_storage where school_id = ${schoolId}`)[0]!;

  /** Sends the parts straight to storage, as the browser does, and returns their ETags. */
  async function sendParts(ticket: { partSize: number; parts: { partNumber: number; url: string }[] }, file: Buffer) {
    return Promise.all(
      ticket.parts.map(async (part) => {
        const response = await fetch(part.url, {
          method: 'PUT',
          body: file.subarray((part.partNumber - 1) * ticket.partSize, part.partNumber * ticket.partSize),
          headers: { origin: WEB_ORIGIN },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-expose-headers')).toMatch(/etag/i);
        return { partNumber: part.partNumber, etag: response.headers.get('etag')! };
      }),
    );
  }

  it('uploads straight to storage in parts, reserving quota, then queues transcoding', async () => {
    const { author, enrolled, school: created, lessonUrl } = await setup();
    const file = Buffer.alloc(17 * 1024 * 1024 + 123, 7);
    const start = await api.request('POST', `${lessonUrl}/upload`, { token: author.token, body: { fileName: 'clip.mp4', size: file.length, contentType: 'video/mp4' } });
    expect(start.status).toBe(201);
    expect(start.body.parts).toHaveLength(2);
    expect(start.body.parts[0].url).toContain(s3config!.endpoint);
    expect(await storage(created.id)).toEqual({ used: 0, reserved: file.length });

    // While uploading, the lesson shows it and students can't play it yet.
    const playing = await api.request('GET', `${lessonUrl}/playback`, { token: enrolled.token });
    expect(playing.body).toMatchObject({ kind: 'processing', status: 'uploading' });

    const parts = await sendParts(start.body, file);
    const done = await api.request('POST', `${lessonUrl}/upload/${start.body.assetId}/complete`, { token: author.token, body: { parts } });
    expect(done.status).toBe(200);
    expect(done.body.video).toMatchObject({ provider: 'upload', status: 'processing', progress: 0 });
    expect(await storage(created.id)).toEqual({ used: file.length, reserved: 0 });
    const [event] = await owner`select payload from outbox where type = 'media.uploaded' and payload->>'assetId' = ${start.body.assetId}`;
    expect(event).toBeDefined();
    // Completing twice is refused.
    expect((await api.request('POST', `${lessonUrl}/upload/${start.body.assetId}/complete`, { token: author.token, body: { parts } })).status).toBe(409);
  });

  it("refuses an upload that doesn't fit the school's quota, counting uploads in progress", async () => {
    const { author, school: created, url, lessonUrl } = await setup();
    await owner`update school_storage set quota_bytes = ${30 * 1024 * 1024} where school_id = ${created.id}`;
    const { body: second } = await api.request('POST', `${url}/lessons`, { token: author.token, body: { moduleId: (await api.request('GET', url, { token: author.token })).body.modules[0].id, title: 'Second' } });
    const start = (lesson: string, size: number) =>
      api.request('POST', `${url}/lessons/${lesson}/upload`, { token: author.token, body: { fileName: 'v.mp4', size, contentType: 'video/mp4' } });

    const results = await Promise.all([start(lessonUrl.split('/').pop()!, 20 * 1024 * 1024), start(second.id, 20 * 1024 * 1024)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 403]);
    expect(results.find((result) => result.status === 403)!.body.error.code).toBe('quota_exceeded');
    expect((await storage(created.id)).reserved).toBe(20 * 1024 * 1024);
  });

  it('marks an upload failed when the stored file is not the declared size, and frees the reservation', async () => {
    const { author, school: created, lessonUrl } = await setup();
    const start = await api.request('POST', `${lessonUrl}/upload`, { token: author.token, body: { fileName: 'clip.mp4', size: 6 * 1024 * 1024, contentType: 'video/mp4' } });
    const parts = await sendParts(start.body, Buffer.alloc(1024, 1));
    const done = await api.request('POST', `${lessonUrl}/upload/${start.body.assetId}/complete`, { token: author.token, body: { parts } });
    expect(done.status).toBe(400);
    expect(await storage(created.id)).toEqual({ used: 0, reserved: 0 });
    const [asset] = await owner`select status from media_assets where id = ${start.body.assetId}`;
    expect(asset!.status).toBe('failed');
  });

  it('cancels an upload: the reservation is freed and the lesson has no video again', async () => {
    const { author, school: created, lessonUrl } = await setup();
    const start = await api.request('POST', `${lessonUrl}/upload`, { token: author.token, body: { fileName: 'clip.mp4', size: 1024, contentType: 'video/mp4' } });
    expect((await api.request('DELETE', `${lessonUrl}/upload/${start.body.assetId}`, { token: author.token })).status).toBe(204);
    expect(await storage(created.id)).toEqual({ used: 0, reserved: 0 });
    expect((await api.request('GET', lessonUrl, { token: author.token })).body.video).toBeNull();
  });

  it('refuses uploads from people who can not edit the course, and files that are too big or not video', async () => {
    const { author, enrolled, lessonUrl } = await setup();
    expect((await api.request('POST', `${lessonUrl}/upload`, { token: enrolled.token, body: { fileName: 'a.mp4', size: 10, contentType: 'video/mp4' } })).status).toBe(403);
    const big = await api.request('POST', `${lessonUrl}/upload`, { token: author.token, body: { fileName: 'a.mp4', size: 3 * 1024 ** 3, contentType: 'video/mp4' } });
    expect(big.status).toBe(413);
    expect((await api.request('POST', `${lessonUrl}/upload`, { token: author.token, body: { fileName: 'a.exe', size: 10, contentType: 'application/x-msdownload' } })).status).toBe(400);
  });

  describe('playback of a ready video', () => {
    /** Puts a small transcoded video in place, as the worker would. */
    async function readyVideo() {
      const context = await setup();
      const [asset] = await owner<{ id: string }[]>`
        insert into media_assets (school_id, status, file_name, content_type, declared_bytes, stored_bytes, duration_seconds, has_storyboard, ready_at)
        values (${context.school.id}, 'ready', 'clip.mp4', 'video/mp4', 100, 100, 12.4, true, now()) returning id`;
      await owner`update lessons set video_provider = 'upload', media_id = ${asset!.id}, duration_seconds = 12 where id = ${context.lesson.id}`;
      const root = `schools/${context.school.id}/media/${asset!.id}`;
      const files: Record<string, string> = {
        'hls/master.m3u8': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360\n360p/index.m3u8\n',
        'hls/360p/index.m3u8': '#EXTM3U\n#EXT-X-MAP:URI="init_0.mp4"\n#EXTINF:6.0,\nseg_0000.m4s\n#EXTINF:6.4,\nseg_0001.m4s\n#EXT-X-ENDLIST\n',
        'hls/360p/init_0.mp4': 'init',
        'hls/360p/seg_0000.m4s': 'segment-zero',
        'hls/360p/seg_0001.m4s': 'segment-one',
        'hls/storyboard.vtt': 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nstoryboard-0.jpg#xywh=0,0,160,90\n',
        'hls/storyboard-0.jpg': 'jpeg',
        'poster.jpg': 'poster',
      };
      for (const [file, body] of Object.entries(files)) {
        await s3.send(new PutObjectCommand({ Bucket: s3config!.bucket, Key: `${root}/${file}`, Body: body }));
      }
      return { ...context, assetId: asset!.id };
    }

    it('serves the playlists rewritten to signed storage addresses, to enrolled members only', async () => {
      const { enrolled, visitor, lessonUrl } = await readyVideo();
      expect((await api.request('GET', `${lessonUrl}/playback`, { token: visitor.token })).body.error.code).toBe('enrollment_required');

      const { body: playback } = await api.request('GET', `${lessonUrl}/playback`, { token: enrolled.token });
      expect(playback).toMatchObject({ kind: 'hls', durationSeconds: 12 });
      expect(playback.manifestUrl).toMatch(/^\/api\/v1\/media\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/master\.m3u8\?t=\d{10}\.[\w-]{43}$/);

      const master = await fetch(api.url + playback.manifestUrl);
      expect(master.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
      const variantLine = (await master.text()).split('\n').find((line) => line.startsWith('360p/'))!;
      expect(variantLine).toMatch(/^360p\/index\.m3u8\?t=/);

      const variant = await (await fetch(new URL(variantLine, api.url + playback.manifestUrl))).text();
      const urls = variant.split('\n').filter((line) => line.startsWith('http'));
      expect(urls).toHaveLength(2);
      // Segments outlive the token: a viewer can watch to the end without asking again.
      const signed = new URL(urls[0]!).searchParams;
      const signedAt = signed.get('X-Amz-Date')!.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
      expect(Date.parse(signedAt) + Number(signed.get('X-Amz-Expires')) * 1000).toBeGreaterThanOrEqual(Date.parse(playback.expiresAt));
      expect(await (await fetch(urls[0]!)).text()).toBe('segment-zero');
      const init = /URI="([^"]+)"/.exec(variant)![1]!;
      expect(await (await fetch(init)).text()).toBe('init');

      const vtt = await (await fetch(api.url + playback.storyboardUrl)).text();
      expect(vtt).toMatch(/^http.*storyboard-0\.jpg.*#xywh=0,0,160,90$/m);
      expect((await fetch(playback.posterUrl)).status).toBe(200);
    });

    it('refuses tampered, expired and borrowed tokens', async () => {
      const { enrolled, lessonUrl, school: created, assetId } = await readyVideo();
      const { body: playback } = await api.request('GET', `${lessonUrl}/playback`, { token: enrolled.token });
      const token = new URL(playback.manifestUrl, api.url).searchParams.get('t')!;
      const status = async (path: string) => (await fetch(`${api.url}/api/v1/media/${path}`)).status;

      expect(await status(`${created.id}/${assetId}/master.m3u8?t=${token.slice(0, -2)}AA`)).toBe(403);
      expect(await status(`${created.id}/${assetId}/master.m3u8?t=1000000000.${token.split('.')[1]}`)).toBe(403);
      const { assetId: otherAsset, school: otherSchool } = await readyVideo();
      expect(await status(`${otherSchool.id}/${otherAsset}/master.m3u8?t=${token}`)).toBe(403);
      expect(await status(`${created.id}/${assetId}/..%2F..%2Fsecret/index.m3u8?t=${token}`)).toBe(404);
      expect(await status(`${created.id}/${assetId}/master.m3u8`)).toBe(400);
    });

    it('shows the poster as the course cover and the lesson length in the outline', async () => {
      const { enrolled, url, assetId, school: created } = await readyVideo();
      await owner`update courses set cover_media_id = ${assetId} where school_id = ${created.id}`;
      const { body: course } = await api.request('GET', url, { token: enrolled.token });
      expect(course.coverUrl).toContain('poster.jpg');
      expect(course.modules[0].lessons[0]).toMatchObject({ durationSeconds: 12, video: { provider: 'upload', status: 'ready' } });
    });
  });
});
