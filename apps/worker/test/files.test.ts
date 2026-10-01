import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { SubmissionFilesService } from '../src/files/submission-files.service.js';
import { WorkerModule } from '../src/worker.module.js';

const s3config = inject('s3');

describe.skipIf(!s3config)('handed-in files', () => {
  let owner: postgres.Sql;
  let s3: S3Client;
  let files: SubmissionFilesService;
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
    });
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(config)] }).compile();
    files = moduleRef.get(SubmissionFilesService);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    await close();
    await owner.end();
    s3.destroy();
  });

  /** A school with a student's draft submission, and its storage figures. */
  async function submission(used: number, reserved: number) {
    const [user] = await owner<{ id: string }[]>`insert into users (email, name, password_hash) values (${`f-${randomUUID()}@example.com`}, 'S', 'x') returning id`;
    const [school] = await owner<{ id: string }[]>`insert into schools (slug, name) values (${`files-${randomUUID().slice(0, 8)}`}, 'Files') returning id`;
    const schoolId = school!.id;
    await owner`insert into memberships (school_id, user_id, role) values (${schoolId}, ${user!.id}, 'student')`;
    const [course] = await owner<{ id: string }[]>`insert into courses (school_id, slug, title) values (${schoolId}, 'course', 'Course') returning id`;
    const [module] = await owner<{ id: string }[]>`insert into course_modules (school_id, course_id, title, position) values (${schoolId}, ${course!.id}, 'M', 0) returning id`;
    const [lesson] = await owner<{ id: string }[]>`
      insert into lessons (school_id, course_id, module_id, kind, title, position) values (${schoolId}, ${course!.id}, ${module!.id}, 'assignment', 'A', 0) returning id`;
    const [sub] = await owner<{ id: string }[]>`
      insert into assignment_submissions (school_id, course_id, lesson_id, user_id) values (${schoolId}, ${course!.id}, ${lesson!.id}, ${user!.id}) returning id`;
    await owner`update school_storage set used_bytes = ${used}, reserved_bytes = ${reserved} where school_id = ${schoolId}`;
    return { schoolId, submissionId: sub!.id };
  }

  const storage = async (schoolId: string) =>
    (await owner<{ used: number; reserved: number }[]>`select used_bytes::int as used, reserved_bytes::int as reserved from school_storage where school_id = ${schoolId}`)[0]!;
  const exists = (key: string) =>
    s3.send(new HeadObjectCommand({ Bucket: s3config!.bucket, Key: key })).then(
      () => true,
      () => false,
    );

  it("removes deleted submissions' files and gives their space back", async () => {
    const { schoolId, submissionId } = await submission(100, 7);
    const kept = `schools/${schoolId}/submissions/${submissionId}/${randomUUID()}`;
    await s3.send(new PutObjectCommand({ Bucket: s3config!.bucket, Key: kept, Body: 'x'.repeat(40) }));
    await files.deleted({
      schoolId,
      files: [
        { key: kept, bytes: 40, uploaded: true },
        { key: `schools/${schoolId}/submissions/${submissionId}/${randomUUID()}`, bytes: 7, uploaded: false },
      ],
    });
    expect(await exists(kept)).toBe(false);
    expect(await storage(schoolId)).toEqual({ used: 60, reserved: 0 });
  });

  it('clears away uploads never finished within a day, freeing their reservation', async () => {
    const { schoolId, submissionId } = await submission(0, 30);
    const [old] = await owner<{ id: string }[]>`
      insert into submission_files (school_id, submission_id, file_name, content_type, size_bytes, created_at)
      values (${schoolId}, ${submissionId}, 'old.pdf', 'application/pdf', 20, now() - interval '2 days') returning id`;
    const [fresh] = await owner<{ id: string }[]>`
      insert into submission_files (school_id, submission_id, file_name, content_type, size_bytes)
      values (${schoolId}, ${submissionId}, 'new.pdf', 'application/pdf', 10) returning id`;
    expect(await files.abandonStale()).toBeGreaterThanOrEqual(1);
    expect(await owner`select id from submission_files where id in (${old!.id}, ${fresh!.id})`).toEqual([{ id: fresh!.id }]);
    expect(await storage(schoolId)).toEqual({ used: 0, reserved: 10 });
  });
});
