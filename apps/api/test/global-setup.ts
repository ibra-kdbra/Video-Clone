import type { TestProject } from 'vitest/node';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { migrate } from '../src/database/migrator.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** grand_app's connection string: what the API uses, with row-level security. */
    appDatabaseUrl: string;
    /** The owner's connection string, for arranging data the API couldn't. */
    ownerDatabaseUrl: string;
    redisUrl: string;
    /** S3-compatible storage for the video tests (Garage locally and in CI), or null to skip them. */
    s3: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string } | null;
  }
}

/**
 * Creates a fresh `grand_test` database on the server in TEST_DATABASE_ADMIN_URL (a superuser, as in
 * docker compose or CI), makes sure the grand_app role can log in, and applies the migrations.
 * Redis database 15 (TEST_REDIS_URL) is flushed.
 */
export default async function setup(project: TestProject) {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://grand:grand@localhost:5432/postgres';
  const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin`drop database if exists grand_test with (force)`;
    await admin`create database grand_test`;
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

  const ownerUrl = withDatabase(adminUrl, 'grand_test');
  await migrate(ownerUrl, { log: () => {} });

  const redis = new Redis(redisUrl);
  await redis.flushdb();
  await redis.quit();

  const appUrl = new URL(ownerUrl);
  appUrl.username = 'grand_app';
  appUrl.password = 'grand_app';
  project.provide('appDatabaseUrl', appUrl.toString());
  project.provide('ownerDatabaseUrl', ownerUrl);
  project.provide('redisUrl', redisUrl);
  project.provide('s3', await storageForTests());
}

/** TEST_S3_* point at a bucket the tests may write to; its CORS is set for the test web origin. */
async function storageForTests() {
  const { TEST_S3_ENDPOINT: endpoint, TEST_S3_BUCKET: bucket, TEST_S3_ACCESS_KEY_ID: accessKeyId, TEST_S3_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  const region = process.env.TEST_S3_REGION ?? 'garage';
  const client = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [{ AllowedOrigins: ['http://localhost:5173'], AllowedMethods: ['GET', 'PUT', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 600 }],
      },
    }),
  );
  client.destroy();
  return { endpoint, bucket, accessKeyId, secretAccessKey, region };
}

function withDatabase(url: string, database: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
