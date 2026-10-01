/**
 * `npm run db:migrate`: applies pending migrations as the database owner (DATABASE_MIGRATION_URL),
 * not as the API's own role.
 */
import { migrate } from './migrator.js';

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error('Set DATABASE_MIGRATION_URL to the database owner\'s connection string.');
  process.exit(1);
}

try {
  const { applied } = await migrate(url);
  console.log(applied.length ? `Done: ${applied.length} migration(s) applied.` : 'Up to date.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
