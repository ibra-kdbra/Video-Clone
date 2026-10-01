import type { TestProject } from 'vitest/node';
import postgres from 'postgres';
import { migrate } from '../../api/src/database/migrator.js';

declare module 'vitest' {
  export interface ProvidedContext {
    appDatabaseUrl: string;
    ownerDatabaseUrl: string;
    redisUrl: string;
    s3: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string } | null;
  }
}

/** Its own database (grand_worker_test), migrated with the API's migrations. */
export default async function setup(project: TestProject) {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://grand:grand@localhost:5432/postgres';
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin`drop database if exists grand_worker_test with (force)`;
    await admin`create database grand_worker_test`;
    await admin.unsafe(`
      do $$ begin
        if not exists (select from pg_roles where rolname = 'grand_app') then
          create role grand_app login password 'grand_app';
        else
          alter role grand_app with login password 'grand_app';
        end if;
      end $$`);
  } finally {
    await admin.end();
  }
  const owner = new URL(adminUrl);
  owner.pathname = '/grand_worker_test';
  await migrate(owner.toString(), { log: () => {} });
  const app = new URL(owner);
  app.username = 'grand_app';
  app.password = 'grand_app';
  project.provide('ownerDatabaseUrl', owner.toString());
  project.provide('appDatabaseUrl', app.toString());
  project.provide('redisUrl', process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/14');
  const { TEST_S3_ENDPOINT: endpoint, TEST_S3_BUCKET: bucket, TEST_S3_ACCESS_KEY_ID: accessKeyId, TEST_S3_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
  project.provide(
    's3',
    endpoint && bucket && accessKeyId && secretAccessKey ? { endpoint, bucket, accessKeyId, secretAccessKey, region: process.env.TEST_S3_REGION ?? 'garage' } : null,
  );
}
