import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type { BootstrapStatus } from '@starlit/contracts';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly pool: Pool;
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required. Use npm run dev for local setup.');
    this.pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000, query_timeout: 3000, statement_timeout: 3000, application_name: 'starlit-api' });
    this.pool.on('error', () => console.error('[database] idle connection unavailable'));
  }
  async status(): Promise<BootstrapStatus> {
    const { rows } = await this.pool.query<{version: string; installed_at: Date; database_time: Date}>(
      `SELECT version, installed_at, clock_timestamp() AS database_time FROM schema_migrations ORDER BY version DESC LIMIT 1`);
    const row = rows[0];
    if (!row || row.version !== '020_roster_revisions.sql') throw new Error('Database schema is not ready');
    return { service: 'starlit-api', database: 'connected', databaseTime: row.database_time.toISOString(),
      schemaVersion: row.version, installedAt: row.installed_at.toISOString() };
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    // pg-pool removes its idle error listener while a client is checked out.
    // A disconnect between queries must reject this transaction, not crash Node.
    let connectionError: Error | undefined;
    const onConnectionError = (error: Error) => { connectionError = error; };
    client.on('error', onConnectionError);
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL TIME ZONE 'UTC'");
      await client.query("SET LOCAL lock_timeout = '3s'");
      const result = await work(client);
      if (connectionError) throw connectionError;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { connectionError ??= rollbackError instanceof Error ? rollbackError : new Error('Rollback failed'); }
      throw error;
    } finally {
      client.release(connectionError);
      client.removeListener('error', onConnectionError);
    }
  }
  async onApplicationShutdown() { await this.pool.end(); }
}
