import type { TestProject } from 'vitest/node';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { migrate } from '../src/database/migrator.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** grand_app's connection string: what the API uses, with row-level security. */
    appDatabaseUrl: string;
    /** The owner's connection string, for arranging data the API couldn't. */
    ownerDatabaseUrl: string;
    redisUrl: string;
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
}

function withDatabase(url: string, database: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
