import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../migrations');
const FILE_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies the SQL files in migrations/ in order, each in its own transaction, and records them in
 * schema_migrations with a checksum. An advisory lock makes concurrent runs (two deploys at once)
 * wait for each other, and a changed checksum on an applied file stops the run: applied
 * migrations are history and are never edited, only followed by new ones.
 */
export async function migrate(
  url: string,
  { dir = MIGRATIONS_DIR, log = (message: string) => console.log(message) } = {},
): Promise<MigrationResult> {
  const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { application_name: 'grand-migrate' } });
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await sql`select pg_advisory_lock(hashtext('grand-lms:migrations'))`;
    await sql`
      create table if not exists schema_migrations (
        name       text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )`;
    const applied = new Map((await sql<{ name: string; checksum: string }[]>`select name, checksum from schema_migrations`).map((row) => [row.name, row.checksum]));
    const files = readdirSync(dir).filter((name) => FILE_NAME.test(name)).sort();

    for (const name of applied.keys()) {
      if (!files.includes(name)) log(`warning: ${name} was applied but is no longer in ${dir}`);
    }
    for (const name of files) {
      const content = readFileSync(path.join(dir, name), 'utf8');
      const checksum = createHash('sha256').update(content).digest('hex');
      const previous = applied.get(name);
      if (previous) {
        if (previous !== checksum) throw new Error(`${name} changed after it was applied. Add a new migration instead.`);
        result.skipped.push(name);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`insert into schema_migrations (name, checksum) values (${name}, ${checksum})`;
      });
      result.applied.push(name);
      log(`applied ${name}`);
    }
    return result;
  } finally {
    await sql`select pg_advisory_unlock(hashtext('grand-lms:migrations'))`.catch(() => {});
    await sql.end({ timeout: 5 });
  }
}
