import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { AppConfig } from '../config/app-config.js';
import { schema } from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Who a transaction acts for. Row-level security decides what it can see and change from this. */
export interface Scope {
  userId?: string | null;
  schoolId?: string | null;
}

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  readonly client: postgres.Sql;
  private readonly db: Db;

  constructor(config: AppConfig) {
    this.client = postgres(config.database.url, {
      max: config.database.poolSize,
      idle_timeout: 60,
      connect_timeout: 10,
      onnotice: () => {},
      connection: {
        application_name: 'grand-api',
        // A stuck query or an abandoned transaction can't hold a pooled connection for long.
        statement_timeout: 10_000,
        idle_in_transaction_session_timeout: 15_000,
      },
    });
    this.db = drizzle(this.client, { schema });
  }

  /**
   * Runs `work` in one transaction that acts for `scope`: the person and school are set as
   * transaction-local settings, which the row-level security policies read. Every query the API
   * makes goes through here, so a query that forgets a `where school_id = ...` still can't reach
   * another school's rows.
   */
  transaction<T>(scope: Scope, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.user_id', ${scope.userId ?? ''}, true), set_config('app.school_id', ${scope.schoolId ?? ''}, true)`,
      );
      return work(tx);
    });
  }

  async ping() {
    await this.client`select 1`;
  }

  async onApplicationShutdown() {
    await this.client.end({ timeout: 5 });
    this.logger.log('Database connections closed');
  }
}
